import { promises as fsPromises } from 'node:fs';
import { parse, resolve } from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDF_TO_PNG_OPTIONS_DEFAULTS } from './const.js';
import { FilesystemSink } from './filesystemSink.js';
import type { PngPageOutput } from './interfaces/index.js';
import type { OutputSink } from './interfaces/output.sink.js';
import type { NormalizedPdfToPngOptions } from './normalizePdfToPngOptions.js';
import { NullSink } from './nullSink.js';
import { processAndSavePage, resolvePageName } from './pageOrchestrator.js';
import { getPdfFileBuffer } from './pdfInput.js';
import { getPdfDocument } from './pdfjsLoader.js';

async function processPagesWithSlidingWindow<T>(
    pageNumbers: number[],
    concurrencyLimit: number,
    processPage: (pageNumber: number, index: number) => Promise<T>,
): Promise<T[]> {
    const results = new Array<T>(pageNumbers.length);
    let nextIndex = 0;
    let firstError: unknown;

    async function runWorker(): Promise<void> {
        while (firstError === undefined && nextIndex < pageNumbers.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            try {
                results[currentIndex] = await processPage(pageNumbers[currentIndex], currentIndex);
            } catch (error: unknown) {
                firstError ??= error;
            }
        }
    }

    const workerCount = Math.min(concurrencyLimit, pageNumbers.length);
    await Promise.allSettled(Array.from({ length: workerCount }, () => runWorker()));

    if (firstError !== undefined) {
        throw firstError;
    }

    return results;
}

/**
 * Finds the first output filename that more than one processed page resolves to.
 *
 * Page names are resolved up front (before any output I/O) so a non-injective `outputFileMaskFunc`
 * or a duplicated `pagesToProcess` entry surfaces as a clear, deterministic error instead of a raw
 * `EEXIST` from the exclusive-create (`'wx'`) write — which previously also left the first colliding
 * file on disk and leaked the absolute output path. See VAL-001.
 *
 * Iterates in first-seen order, so the reported duplicate is deterministic regardless of whether
 * pages are later rendered sequentially or in parallel.
 */
function findDuplicateOutputName(names: string[], pageNumbers: number[]): { name: string; pages: number[] } | undefined {
    const pagesByName = new Map<string, number[]>();
    for (let index = 0; index < names.length; index += 1) {
        const existing = pagesByName.get(names[index]) ?? [];
        pagesByName.set(names[index], [...existing, pageNumbers[index]]);
    }
    for (const [name, pages] of pagesByName) {
        if (pages.length > 1) {
            return { name, pages };
        }
    }
    return undefined;
}

/**
 * Internal conversion entry point that bypasses the public-API normalization step.
 *
 * Callers — currently the public `pdfToPng()` wrapper and the CLI — are responsible for
 * producing a fully-validated `NormalizedPdfToPngOptions` (via `normalizePdfToPngOptions`)
 * before invoking this function. The single-normalize contract is what makes
 * `NormalizedPdfToPngOptions` the sole validation boundary of the library.
 *
 * This module is NOT re-exported from `src/index.ts`; it is an internal seam.
 */
export async function pdfToPngCore(
    pdfFile: string | ArrayBufferLike | Uint8Array,
    normalizedProps: NormalizedPdfToPngOptions,
): Promise<PngPageOutput[]> {
    const pageViewportScale = normalizedProps.viewportScale;
    const pdfFileBuffer: Uint8Array | ArrayBufferLike = await getPdfFileBuffer(pdfFile, normalizedProps.maxInputBytes);
    const pdfDocument: PDFDocumentProxy = await getPdfDocument(pdfFileBuffer, normalizedProps);

    // Wrap ALL post-load work in this try so the worker is destroyed even if setup steps
    // (path resolution, mkdir, realpath, sink construction) throw — not just render-time errors.
    try {
        const pagesToProcess: number[] =
            normalizedProps.pagesToProcess ?? Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1);
        const validPagesToProcess: number[] = pagesToProcess.filter((pageNumber) => pageNumber <= pdfDocument.numPages && pageNumber >= 1);
        const returnMetadataOnly = normalizedProps.returnMetadataOnly;
        const resolvedOutputFolder: string | undefined =
            normalizedProps.outputFolder !== undefined && !returnMetadataOnly ? resolve(normalizedProps.outputFolder) : undefined;

        const defaultMask: string = typeof pdfFile === 'string' ? parse(pdfFile).name : PDF_TO_PNG_OPTIONS_DEFAULTS.outputFileMask;

        // Resolve every page name up front. resolvePageName also enforces the non-empty and
        // flat-filename rules, so that validation continues to fire for in-memory conversions too.
        const resolvedNames: string[] = validPagesToProcess.map((pageNumber) =>
            resolvePageName(pageNumber, defaultMask, normalizedProps.outputFileMaskFunc),
        );

        // Collisions only corrupt output when pages are written to disk; in-memory / metadata-only
        // conversions may legitimately repeat a name. Reject duplicates before any output I/O
        // (before mkdir/realpath/write) so nothing is created and no partial output is left behind.
        if (resolvedOutputFolder !== undefined) {
            const duplicate = findDuplicateOutputName(resolvedNames, validPagesToProcess);
            if (duplicate !== undefined) {
                throw new Error(
                    `Duplicate output filename "${duplicate.name}" for pages ${duplicate.pages.join(', ')}. ` +
                        `Each processed page must resolve to a unique filename.`,
                );
            }
            await fsPromises.mkdir(resolvedOutputFolder, { recursive: true });
        }
        const realOutputFolder: string | undefined =
            resolvedOutputFolder !== undefined ? await fsPromises.realpath(resolvedOutputFolder) : undefined;
        const pngPageOutputs: PngPageOutput[] = [];

        const shouldReturnContent: boolean = returnMetadataOnly
            ? false
            : normalizedProps.outputFolder
              ? true
              : normalizedProps.returnPageContent;
        const outputSink: OutputSink | undefined =
            resolvedOutputFolder !== undefined && realOutputFolder !== undefined
                ? new FilesystemSink(resolvedOutputFolder, realOutputFolder)
                : shouldReturnContent
                  ? new NullSink()
                  : undefined;
        const processPage = async (pageNumber: number, index: number): Promise<PngPageOutput> =>
            await processAndSavePage(
                pdfDocument,
                resolvedNames[index],
                pageNumber,
                pageViewportScale,
                shouldReturnContent,
                returnMetadataOnly,
                outputSink,
                normalizedProps.returnPageContent,
            );

        if (normalizedProps.processPagesInParallel === true) {
            pngPageOutputs.push(
                ...(await processPagesWithSlidingWindow(validPagesToProcess, normalizedProps.concurrencyLimit, processPage)),
            );
        } else {
            for (const [index, pageNumber] of validPagesToProcess.entries()) {
                pngPageOutputs.push(await processPage(pageNumber, index));
            }
        }

        return pngPageOutputs;
    } finally {
        await pdfDocument.loadingTask.destroy();
    }
}
