import type { PDFDocumentProxy } from 'pdfjs-dist';
import { containsPathSeparator, SEPARATOR_DESCRIPTION } from './flatFilename.js';
import type { FilePngPageOutput, InMemoryPngPageOutput, PngPageOutput } from './interfaces/index.js';
import type { PageMode } from './pageMode.js';
import { getPageMetadata, renderPdfPage } from './pageRenderer.js';

/** The two `PageMode`s that involve an actual render (everything except `metadata`). */
export type RenderedPageMode = Exclude<PageMode, { kind: 'metadata' }>;

function assertFlatFilename(name: string, pageNumber: number): void {
    if (containsPathSeparator(name)) {
        throw new Error(
            `outputFileMaskFunc returned a filename containing a path separator for page ${pageNumber}: "${name}". The filename must be a flat name with no ${SEPARATOR_DESCRIPTION} characters.`,
        );
    }
}

export function resolvePageName(
    pageNumber: number,
    defaultMask: string,
    outputFileMaskFunc: ((page: number) => string) | undefined,
): string {
    if (outputFileMaskFunc === undefined) {
        return `${defaultMask}_page_${pageNumber}.png`;
    }

    const name: unknown = outputFileMaskFunc(pageNumber);
    if (typeof name !== 'string') {
        throw new Error(
            `outputFileMaskFunc returned a non-string filename for page ${pageNumber}. Provide a string including the .png extension.`,
        );
    }
    if (!name) {
        throw new Error(
            `outputFileMaskFunc returned an empty filename for page ${pageNumber}. Provide a non-empty string including the .png extension.`,
        );
    }

    assertFlatFilename(name, pageNumber);

    return name;
}

/**
 * Applies the output half of a page's lifecycle to an already-rendered page: pass-through for
 * in-memory mode, or sink write + content trimming for file mode. Split out from
 * `processAndSavePage` so worker-thread conversions — where rendering happens off-thread but
 * output must stay on the main thread (path-security guards live here) — reuse the exact same
 * output logic.
 */
export async function finalizePageOutput(pageOutput: InMemoryPngPageOutput, mode: RenderedPageMode): Promise<PngPageOutput> {
    if (mode.kind === 'content') {
        return pageOutput;
    }

    if (pageOutput.content === undefined) {
        throw new Error(`Cannot write PNG file "${pageOutput.name}" because content is undefined.`);
    }
    const resolvedPath = await mode.sink.write(pageOutput.name, pageOutput.content);
    const filePageOutput: FilePngPageOutput = {
        ...pageOutput,
        kind: 'file',
        path: resolvedPath,
        content: mode.returnContent ? pageOutput.content : undefined,
    };
    return filePageOutput;
}

/**
 * Returns whether a rendered page must materialize its PNG Buffer. `file` mode always does (the
 * bytes are needed for the write); `content` mode only when the caller asked to keep it.
 */
export function shouldMaterializeContent(mode: RenderedPageMode): boolean {
    return mode.kind === 'file' ? true : mode.returnContent;
}

export async function processAndSavePage(
    pdfDocument: PDFDocumentProxy,
    pageName: string,
    pageNumber: number,
    pageViewportScale: number,
    mode: PageMode,
): Promise<PngPageOutput> {
    if (mode.kind === 'metadata') {
        return await getPageMetadata(pdfDocument, pageName, pageNumber, pageViewportScale);
    }

    const pageOutput = await renderPdfPage(pdfDocument, pageName, pageNumber, pageViewportScale, shouldMaterializeContent(mode));

    return await finalizePageOutput(pageOutput, mode);
}
