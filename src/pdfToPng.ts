import { parse } from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { MAX_CONCURRENCY_LIMIT, MAX_VIEWPORT_SCALE, PDF_TO_PNG_OPTIONS_DEFAULTS, SEQUENTIAL_PIPELINE_WINDOW } from './const.js';
import {
    assertValidOutputFilename,
    containsHostPathSeparator,
    HOST_PATH_SEPARATOR_DESCRIPTION,
    prepareOutputFolder,
    resolveOutputFolder,
    savePNGfile,
} from './outputWriter.js';
import type { OutputFolderHandle } from './outputWriter.js';
import { getPageMetadata, renderPdfPage } from './pageRenderer.js';
import type { PageRenderResult } from './pageRenderer.js';
import { getPdfFileBuffer } from './pdfInput.js';
import { getPdfDocument, warmUpWasmDecoders, warnIfWasmDecodersMissing } from './pdfjsLoader.js';
import type { PdfToPngOptions, PngPageOutput } from './types.js';
import { VerbosityLevel } from './types.js';
import { renderPagesInWorkerPool, throwLowestIndexedError } from './workerPool.js';
import type { WorkerPageTask, WorkerRenderOptions } from './workerPool.js';

interface NormalizedPdfToPngOptions {
    viewportScale: number;
    disableFontFace: boolean;
    useSystemFonts: boolean;
    enableXfa: boolean;
    pdfFilePassword: string | undefined;
    outputFolder: string | undefined;
    outputFileMaskFunc: ((pageNumber: number) => string) | undefined;
    pagesToProcess: number[] | undefined;
    verbosityLevel: VerbosityLevel;
    returnPageContent: boolean;
    returnMetadataOnly: boolean;
    processPagesInParallel: boolean;
    renderInWorkerThreads: boolean;
    concurrencyLimit: number;
    maxInputBytes: number;
}

let disableFontFaceWarned = false;

/**
 * pdf.js has no Font Loading API in Node.js, so `disableFontFace: false` makes it draw text in embedded fonts as
 * missing-glyph boxes, silently. The option stays accepted for compatibility but its value is ignored; this tells the
 * caller once per process (module state, like the wasm decoder warning in pdfjsLoader.ts).
 */
function warnDisableFontFaceIgnored(): void {
    if (disableFontFaceWarned) {
        return;
    }
    disableFontFaceWarned = true;
    process.emitWarning(
        'disableFontFace: false is ignored and true is used. pdf.js has no Font Loading API in Node.js, so false would ' +
            'render text in embedded fonts as missing-glyph boxes.',
        { code: 'PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED' },
    );
}

/**
 * Validates/defaults the public options once and snapshots caller-owned page arrays. An explicit `disableFontFace: false`
 * is ignored here, with a one-time process warning, so every consumer of the snapshot sees `true`.
 */
function normalizeOptions(props: PdfToPngOptions | undefined): NormalizedPdfToPngOptions {
    const viewportScale = props?.viewportScale ?? PDF_TO_PNG_OPTIONS_DEFAULTS.viewportScale;
    if (typeof viewportScale !== 'number' || !Number.isFinite(viewportScale) || viewportScale <= 0 || viewportScale > MAX_VIEWPORT_SCALE) {
        throw new Error(
            `viewportScale must be a finite number greater than 0 and at most ${MAX_VIEWPORT_SCALE}, received: ${viewportScale}`,
        );
    }

    // null is "unset" for every option (`??`), so it must reach neither the string nor the function paths below.
    const outputFolder = props?.outputFolder ?? undefined;
    if (outputFolder !== undefined && typeof outputFolder !== 'string') {
        throw new Error('outputFolder must be a string');
    }
    if (outputFolder?.trim() === '') {
        throw new Error('outputFolder must not be empty');
    }

    const outputFileMaskFunc = props?.outputFileMaskFunc ?? undefined;
    if (outputFileMaskFunc !== undefined && typeof outputFileMaskFunc !== 'function') {
        throw new Error('outputFileMaskFunc must be a function');
    }

    const verbosityLevel = props?.verbosityLevel ?? VerbosityLevel.ERRORS;
    if (verbosityLevel !== VerbosityLevel.ERRORS && verbosityLevel !== VerbosityLevel.WARNINGS && verbosityLevel !== VerbosityLevel.INFOS) {
        throw new Error('verbosityLevel must be 0, 1, or 5');
    }

    // Only a real Array is accepted: a typed array would keep its own map(), so it would survive as a typed "snapshot" and
    // later turn page names into numbers. Array.from always yields a plain number[], and visits holes as undefined.
    const requestedPages = props?.pagesToProcess ?? undefined;
    if (requestedPages !== undefined && !Array.isArray(requestedPages)) {
        throw new Error('pagesToProcess must be an array of positive integers');
    }
    const pagesToProcess =
        requestedPages === undefined
            ? undefined
            : Array.from(requestedPages, (pageNumber) => {
                  if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
                      throw new Error(`pagesToProcess contains invalid page number: ${pageNumber}`);
                  }
                  return pageNumber;
              });

    const processPagesInParallel = props?.processPagesInParallel ?? false;
    const renderInWorkerThreads = props?.renderInWorkerThreads ?? false;
    const concurrencyLimit = props?.concurrencyLimit ?? PDF_TO_PNG_OPTIONS_DEFAULTS.concurrencyLimit;
    if (processPagesInParallel || renderInWorkerThreads) {
        if (!Number.isInteger(concurrencyLimit) || concurrencyLimit < 1) {
            throw new Error(`concurrencyLimit must be a positive integer >= 1, received: ${concurrencyLimit}`);
        }
        if (concurrencyLimit > MAX_CONCURRENCY_LIMIT) {
            throw new Error(`concurrencyLimit must be between 1 and ${MAX_CONCURRENCY_LIMIT}, received: ${concurrencyLimit}`);
        }
    }

    const maxInputBytes = props?.maxInputBytes ?? PDF_TO_PNG_OPTIONS_DEFAULTS.maxInputBytes;
    if (!Number.isInteger(maxInputBytes) || maxInputBytes <= 0) {
        throw new Error(`maxInputBytes must be a positive integer, received: ${maxInputBytes}`);
    }

    // An explicit false is ignored rather than forwarded, so the main thread and the workers read the same value.
    if (props?.disableFontFace === false) {
        warnDisableFontFaceIgnored();
    }

    return {
        viewportScale,
        disableFontFace: PDF_TO_PNG_OPTIONS_DEFAULTS.disableFontFace,
        useSystemFonts: props?.useSystemFonts ?? PDF_TO_PNG_OPTIONS_DEFAULTS.useSystemFonts,
        enableXfa: props?.enableXfa ?? PDF_TO_PNG_OPTIONS_DEFAULTS.enableXfa,
        pdfFilePassword: props?.pdfFilePassword ?? PDF_TO_PNG_OPTIONS_DEFAULTS.pdfFilePassword,
        outputFolder,
        outputFileMaskFunc,
        pagesToProcess,
        verbosityLevel,
        returnPageContent: props?.returnPageContent ?? true,
        returnMetadataOnly: props?.returnMetadataOnly ?? false,
        processPagesInParallel,
        renderInWorkerThreads,
        concurrencyLimit,
        maxInputBytes,
    };
}

/**
 * Runs the public option contract without starting input I/O and returns its normalized snapshot.
 *
 * @internal Used by the CLI so usage errors are reported before its progress banner and CLI-only
 * policy consumes the same defaults as conversion. The public conversion still validates
 * defensively at its own boundary because library callers do not pass through the CLI.
 */
export function assertValidPdfToPngOptions(props: PdfToPngOptions | undefined): NormalizedPdfToPngOptions {
    return normalizeOptions(props);
}

/** Ordered map with bounded concurrency, deterministic errors, and in-flight draining. */
async function mapLimitOrdered<T, R>(items: T[], limit: number, map: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    const errorsByIndex = new Map<number, unknown>();
    let nextIndex = 0;

    async function run(): Promise<void> {
        while (errorsByIndex.size === 0 && nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            try {
                results[index] = await map(items[index], index);
            } catch (error: unknown) {
                errorsByIndex.set(index, error);
            }
        }
    }

    await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, run));
    throwLowestIndexedError(errorsByIndex);
    return results;
}

function resolvePageName(pageNumber: number, defaultMask: string, mask: ((page: number) => string) | undefined): string {
    if (mask === undefined) {
        return `${defaultMask}_page_${pageNumber}.png`;
    }
    const name: unknown = mask(pageNumber);
    if (typeof name !== 'string') {
        throw new Error(
            `outputFileMaskFunc returned a non-string filename for page ${pageNumber}. Provide a string including the .png extension.`,
        );
    }
    if (name === '') {
        throw new Error(
            `outputFileMaskFunc returned an empty filename for page ${pageNumber}. Provide a non-empty string including the .png extension.`,
        );
    }
    // Naming remains observable in memory-only mode. Host path-separator validation is retained
    // for compatibility; disk-only aliases such as "." are rejected by output preflight below.
    if (containsHostPathSeparator(name)) {
        throw new Error(
            `outputFileMaskFunc returned a filename containing a path separator for page ${pageNumber}: "${name}". The filename must be a flat name with no ${HOST_PATH_SEPARATOR_DESCRIPTION} characters.`,
        );
    }
    return name;
}

/**
 * The key under which two output names count as one file. It folds what common filesystems treat as one name: canonical
 * equivalence (NFC and NFD forms, which macOS stores as one), full case folding (sharp s and SS, sigma and final sigma),
 * and lone surrogates, which Node encodes to the same U+FFFD bytes in a path. Lower, upper, lower is idempotent where
 * upper, lower is not (capital sharp s U+1E9E would stay apart from ss). It also rejects some names a case-sensitive
 * filesystem keeps apart, the same conservative trade the ASCII case rule already makes.
 */
function outputNameKey(name: string): string {
    return name.toWellFormed().normalize('NFD').toLowerCase().toUpperCase().toLowerCase();
}

function findDuplicateOutputName(names: string[], pages: number[]): { name: string; pages: number[] } | undefined {
    const byKey = new Map<string, { name: string; pages: number[] }>();
    for (let index = 0; index < names.length; index += 1) {
        const key = outputNameKey(names[index]);
        const existing = byKey.get(key);
        if (existing === undefined) {
            byKey.set(key, { name: names[index], pages: [pages[index]] });
        } else {
            existing.pages.push(pages[index]);
        }
    }
    for (const entry of byKey.values()) {
        if (entry.pages.length > 1) return entry;
    }
    return undefined;
}

function pageOutput(kind: 'metadata' | 'content', pageNumber: number, name: string, rendered: PageRenderResult): PngPageOutput {
    const page = {
        pageNumber,
        name,
        width: rendered.width,
        height: rendered.height,
        rotation: rendered.rotation,
    };
    return kind === 'metadata'
        ? {
              ...page,
              kind,
              content: undefined,
              path: '',
          }
        : {
              ...page,
              kind,
              content: rendered.content,
              path: '',
          };
}

async function finalizePage(
    pageNumber: number,
    name: string,
    rendered: PageRenderResult,
    folder: OutputFolderHandle | undefined,
    returnPageContent: boolean,
): Promise<PngPageOutput> {
    if (folder === undefined) {
        return pageOutput('content', pageNumber, name, rendered);
    }
    if (rendered.content === undefined) {
        throw new Error(`Cannot write PNG file "${name}" because content is undefined.`);
    }
    const path = await savePNGfile(name, rendered.content, folder);
    return {
        kind: 'file',
        pageNumber,
        name,
        content: returnPageContent ? rendered.content : undefined,
        path,
        width: rendered.width,
        height: rendered.height,
        rotation: rendered.rotation,
    };
}

/** Converts a PDF input into ordered PNG page results. */
export async function pdfToPng(pdfFile: string | ArrayBufferLike | Uint8Array, props?: PdfToPngOptions): Promise<PngPageOutput[]> {
    const options: NormalizedPdfToPngOptions = normalizeOptions(props);
    // Resolve a relative folder once, before the first await: a later process.chdir() (by the caller, or by another
    // conversion's outputFileMaskFunc) must not redirect it. It also precedes this conversion's own mask callbacks.
    const resolvedOutputFolder =
        options.returnMetadataOnly || options.outputFolder === undefined ? undefined : resolveOutputFolder(options.outputFolder);
    const pdfBytes = await getPdfFileBuffer(pdfFile, options.maxInputBytes);
    // Main pdf.js loading detaches its input; workers need a retained source for their clones.
    const workerPdfBytes = options.renderInWorkerThreads && !options.returnMetadataOnly ? Uint8Array.from(pdfBytes) : undefined;
    // Every main-thread document opens after the one-time wasm warm-up (issue #288).
    await warmUpWasmDecoders();
    const pdfDocument: PDFDocumentProxy = await getPdfDocument(pdfBytes, options);

    try {
        const pageNumbers: number[] =
            options.pagesToProcess === undefined
                ? Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1)
                : options.pagesToProcess.filter((pageNumber) => pageNumber >= 1 && pageNumber <= pdfDocument.numPages);

        const defaultMask = typeof pdfFile === 'string' ? parse(pdfFile).name : PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask;
        const names = pageNumbers.map((pageNumber) => resolvePageName(pageNumber, defaultMask, options.outputFileMaskFunc));

        if (resolvedOutputFolder !== undefined) {
            for (const name of names) assertValidOutputFilename(name);
            const duplicate = findDuplicateOutputName(names, pageNumbers);
            if (duplicate !== undefined) {
                throw new Error(
                    `Duplicate output filename "${duplicate.name}" for pages ${duplicate.pages.join(', ')}. ` +
                        'Each processed page must resolve to a unique filename.',
                );
            }
        }

        const mainThreadLimit = options.processPagesInParallel ? options.concurrencyLimit : SEQUENTIAL_PIPELINE_WINDOW;

        if (options.returnMetadataOnly) {
            return await mapLimitOrdered(pageNumbers, mainThreadLimit, async (pageNumber, index) =>
                pageOutput('metadata', pageNumber, names[index], await getPageMetadata(pdfDocument, pageNumber, options.viewportScale)),
            );
        }

        warnIfWasmDecodersMissing();
        const folder = resolvedOutputFolder === undefined ? undefined : await prepareOutputFolder(resolvedOutputFolder);
        const materializeContent = folder !== undefined || options.returnPageContent;

        if (workerPdfBytes !== undefined) {
            const tasks: WorkerPageTask[] = pageNumbers.map((pageNumber, index) => ({ index, pageNumber }));
            const renderOptions: WorkerRenderOptions = {
                viewportScale: options.viewportScale,
                disableFontFace: options.disableFontFace,
                useSystemFonts: options.useSystemFonts,
                enableXfa: options.enableXfa,
                pdfFilePassword: options.pdfFilePassword,
                verbosityLevel: options.verbosityLevel,
            };
            const results = new Array<PngPageOutput>(tasks.length);
            await renderPagesInWorkerPool(
                workerPdfBytes,
                renderOptions,
                materializeContent,
                tasks,
                options.concurrencyLimit,
                async (index, rendered) => {
                    results[index] = await finalizePage(tasks[index].pageNumber, names[index], rendered, folder, options.returnPageContent);
                },
            );
            return results;
        }

        return await mapLimitOrdered(pageNumbers, mainThreadLimit, async (pageNumber, index) =>
            finalizePage(
                pageNumber,
                names[index],
                await renderPdfPage(pdfDocument, pageNumber, options.viewportScale, materializeContent),
                folder,
                options.returnPageContent,
            ),
        );
    } finally {
        await pdfDocument.loadingTask.destroy();
    }
}
