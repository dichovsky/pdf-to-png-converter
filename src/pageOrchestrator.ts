import { sep } from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { FilePngPageOutput, PngPageOutput } from './interfaces/index.js';
import type { PageMode } from './pageMode.js';
import { getPageMetadata, renderPdfPage } from './pageRenderer.js';

// Reject only characters the host OS treats as path separators. On Windows both "\" and "/"
// are separators; on POSIX only "/" is — "\" is a valid filename character there, so PDFs
// such as `foo\bar.pdf` must still convert successfully when the library derives the default
// page-name mask from `path.parse(pdfFile).name`.
const PATH_SEPARATOR_PATTERN = sep === '\\' ? /[\\/]/ : /\//;
const SEPARATOR_DESCRIPTION = sep === '\\' ? '"/" or "\\"' : '"/"';

function assertFlatFilename(name: string, pageNumber: number): void {
    if (PATH_SEPARATOR_PATTERN.test(name)) {
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

    const name: string = outputFileMaskFunc(pageNumber);
    if (!name) {
        throw new Error(
            `outputFileMaskFunc returned an empty filename for page ${pageNumber}. Provide a non-empty string including the .png extension.`,
        );
    }

    assertFlatFilename(name, pageNumber);

    return name;
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

    // The page is always rendered (the canvas is needed for dimensions); this flag only controls
    // whether the PNG Buffer is materialized. `file` mode always materializes it so the page can be
    // written; `content` mode materializes it only when the caller asked to keep it.
    const shouldReturnContent = mode.kind === 'file' ? true : mode.returnContent;
    const pageOutput = await renderPdfPage(pdfDocument, pageName, pageNumber, pageViewportScale, shouldReturnContent);

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
