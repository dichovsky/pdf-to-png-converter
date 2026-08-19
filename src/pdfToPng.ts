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
import { getPdfDocument } from './pdfjsLoader.js';
import type { PdfToPngOptions, PngPageOutput } from './types.js';
import { VerbosityLevel } from './types.js';
import { renderPagesInWorkerPool } from './workerPool.js';
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

/** Validates/defaults the public options once and snapshots caller-owned page arrays. */
function normalizeOptions(props: PdfToPngOptions | undefined): NormalizedPdfToPngOptions {
    const viewportScale = props?.viewportScale ?? PDF_TO_PNG_OPTIONS_DEFAULTS.viewportScale;
    if (typeof viewportScale !== 'number' || !Number.isFinite(viewportScale) || viewportScale <= 0 || viewportScale > MAX_VIEWPORT_SCALE) {
        throw new Error(
            `viewportScale must be a finite number greater than 0 and at most ${MAX_VIEWPORT_SCALE}, received: ${viewportScale}`,
        );
    }

    const outputFolder = props?.outputFolder;
    if (outputFolder?.trim() === '') {
        throw new Error('outputFolder must not be empty');
    }

    const verbosityLevel = props?.verbosityLevel ?? VerbosityLevel.ERRORS;
    if (verbosityLevel !== VerbosityLevel.ERRORS && verbosityLevel !== VerbosityLevel.WARNINGS && verbosityLevel !== VerbosityLevel.INFOS) {
        throw new Error('verbosityLevel must be 0, 1, or 5');
    }

    const pagesToProcess = props?.pagesToProcess?.map((pageNumber) => {
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

    return {
        viewportScale,
        disableFontFace: props?.disableFontFace ?? PDF_TO_PNG_OPTIONS_DEFAULTS.disableFontFace,
        useSystemFonts: props?.useSystemFonts ?? PDF_TO_PNG_OPTIONS_DEFAULTS.useSystemFonts,
        enableXfa: props?.enableXfa ?? PDF_TO_PNG_OPTIONS_DEFAULTS.enableXfa,
        pdfFilePassword: props?.pdfFilePassword ?? PDF_TO_PNG_OPTIONS_DEFAULTS.pdfFilePassword,
        outputFolder,
        outputFileMaskFunc: props?.outputFileMaskFunc,
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
 * Runs the public option contract without starting input I/O.
 *
 * @internal Used by the CLI so usage errors are reported before its progress banner. The public
 * conversion still validates defensively at its own boundary because library callers do not pass
 * through the CLI.
 */
export function assertValidPdfToPngOptions(props: PdfToPngOptions | undefined): void {
    normalizeOptions(props);
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
    if (errorsByIndex.size > 0) {
        throw errorsByIndex.get(Math.min(...errorsByIndex.keys()));
    }
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

function findDuplicateOutputName(names: string[], pages: number[]): { name: string; pages: number[] } | undefined {
    const byKey = new Map<string, { name: string; pages: number[] }>();
    for (let index = 0; index < names.length; index += 1) {
        const key = names[index].toLowerCase();
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
    return kind === 'metadata'
        ? {
              kind,
              pageNumber,
              name,
              content: undefined,
              path: '',
              width: rendered.width,
              height: rendered.height,
              rotation: rendered.rotation,
          }
        : {
              kind,
              pageNumber,
              name,
              content: rendered.content,
              path: '',
              width: rendered.width,
              height: rendered.height,
              rotation: rendered.rotation,
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
    const pdfBytes = await getPdfFileBuffer(pdfFile, options.maxInputBytes);
    const useWorkers: boolean = options.renderInWorkerThreads && !options.returnMetadataOnly;
    // Main pdf.js loading detaches its input; workers need a retained source for their clones.
    const workerPdfBytes = useWorkers ? Uint8Array.from(pdfBytes) : undefined;
    const pdfDocument: PDFDocumentProxy = await getPdfDocument(pdfBytes, options);

    try {
        const pageNumbers: number[] =
            options.pagesToProcess === undefined
                ? Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1)
                : options.pagesToProcess.filter((pageNumber) => pageNumber >= 1 && pageNumber <= pdfDocument.numPages);

        // Resolve the path before callbacks run so process.chdir() cannot redirect a relative folder.
        const resolvedOutputFolder =
            options.returnMetadataOnly || options.outputFolder === undefined ? undefined : resolveOutputFolder(options.outputFolder);
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

        if (options.returnMetadataOnly) {
            const limit = options.processPagesInParallel ? options.concurrencyLimit : SEQUENTIAL_PIPELINE_WINDOW;
            return await mapLimitOrdered(pageNumbers, limit, async (pageNumber, index) =>
                pageOutput('metadata', pageNumber, names[index], await getPageMetadata(pdfDocument, pageNumber, options.viewportScale)),
            );
        }

        const folder = resolvedOutputFolder === undefined ? undefined : await prepareOutputFolder(resolvedOutputFolder);
        const materializeContent = folder !== undefined || options.returnPageContent;

        if (useWorkers && workerPdfBytes !== undefined) {
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

        const limit = options.processPagesInParallel ? options.concurrencyLimit : SEQUENTIAL_PIPELINE_WINDOW;
        return await mapLimitOrdered(pageNumbers, limit, async (pageNumber, index) =>
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
