import type { PdfToPngOptions, PngPageOutput } from './interfaces/index.js';
import { normalizePdfToPngOptions } from './normalizePdfToPngOptions.js';
import { pdfToPngCore } from './pdfToPngCore.js';

/**
 * Convert PDF pages to PNG buffers and/or files.
 *
 * Sole public entry point. Validates and defaults `props` via `normalizePdfToPngOptions`,
 * then delegates to the internal `pdfToPngCore`. The CLI calls `pdfToPngCore` directly
 * with its own already-normalized options to avoid double validation.
 *
 * @param pdfFile - PDF file path (string), `ArrayBufferLike`, or `Uint8Array`.
 * @param props - Optional caller-facing options; see {@link PdfToPngOptions}.
 * @returns One `PngPageOutput` per processed page.
 */
export async function pdfToPng(pdfFile: string | ArrayBufferLike | Uint8Array, props?: PdfToPngOptions): Promise<PngPageOutput[]> {
    return pdfToPngCore(pdfFile, normalizePdfToPngOptions(props));
}
