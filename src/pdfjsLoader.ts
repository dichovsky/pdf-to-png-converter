import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type * as PdfjsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import { PDFJS_ASSET_DIRECTORIES, PDFJS_WASM_DECODER_FILES } from './const.js';
import type { VerbosityLevel } from './types.js';

/** The validated document-loading options consumed by pdf.js. */
export interface PdfDocumentOptions {
    disableFontFace: boolean;
    useSystemFonts: boolean;
    enableXfa: boolean;
    pdfFilePassword: string | undefined;
    verbosityLevel: VerbosityLevel;
}

let pdfjsLib: typeof PdfjsModule | undefined;
let pdfjsPackageRoot: string | undefined;
let wasmDecodersChecked = false;

/**
 * Locates the installed pdfjs-dist package from this module's own location. There is deliberately no
 * working-directory fallback: a `node_modules` folder in `process.cwd()` is not necessarily the copy that
 * pdf.js was imported from, and pdf.js can import JavaScript from the asset URL it is given.
 */
function locatePdfjsPackageRoot(): string {
    try {
        return dirname(createRequire(__filename).resolve('pdfjs-dist/package.json'));
    } catch (error) {
        throw new Error(
            `Cannot locate the installed "pdfjs-dist" package from "${__filename}". ` +
                'pdf-to-png-converter reads the pdf.js cmaps, standard_fonts and wasm folders from that package, ' +
                'so install pdfjs-dist where this library can resolve it.',
            { cause: error },
        );
    }
}

/**
 * Absolute filesystem path of an asset directory inside the installed pdfjs-dist package.
 * The package root is located once, so asset lookup does not depend on the process working directory
 * or on `node_modules` sitting in `process.cwd()`.
 */
export function pdfjsAssetDirectory(directory: string): string {
    pdfjsPackageRoot ??= locatePdfjsPackageRoot();
    return join(pdfjsPackageRoot, directory);
}

/**
 * Emits one process warning (per process, main thread only) when the pdf.js wasm decoders are absent.
 * pdf.js swallows the resulting decode failure and renders the image blank, so without this a damaged
 * install is silent below verbosity 1. It checks that the files exist; it cannot detect decode errors.
 */
export function warnIfWasmDecodersMissing(): void {
    if (wasmDecodersChecked) {
        return;
    }
    const directory = pdfjsAssetDirectory(PDFJS_ASSET_DIRECTORIES.wasm);
    wasmDecodersChecked = true;
    const missing = PDFJS_WASM_DECODER_FILES.filter((file) => !existsSync(join(directory, file)));
    if (missing.length > 0) {
        process.emitWarning(
            `pdfjs-dist decoder files missing in ${directory}: ${missing.join(', ')}. ` +
                'Images that use CCITT or JBIG2 (jbig2.wasm) or JPEG 2000 (openjpeg.wasm) compression render blank without them.',
            { code: 'PDF_TO_PNG_WASM_MISSING' },
        );
    }
}

/**
 * Builds a pdf.js factory URL from an absolute directory with a portable trailing forward slash.
 * Do not switch this back to `path.sep`: on Windows a backslash terminator makes pdf.js reject
 * the value with "must include trailing slash" and breaks every conversion (issue #173).
 *
 * Known, accepted limit (issue #278): pdf.js reads the wasm decoders with `fs.readFile(url + name)`, which
 * accepts this plain `C:/...` form, but its JavaScript fallback (`jbig2_nowasm_fallback.js`) uses `import()`,
 * which rejects `C:/...` on Windows. The fallback only runs after the wasm read has already failed.
 * A `file:///` URL would flip the two. A custom `BinaryDataFactory` could serve both, but pdf.js does not
 * export it, so it stays out of scope.
 */
function factoryUrl(path: string): string {
    const absolute = resolve(path).split(sep).join('/');
    return absolute.endsWith('/') ? absolute : `${absolute}/`;
}

export async function getPdfDocument(pdfFileBuffer: Uint8Array, opts: PdfDocumentOptions): Promise<PDFDocumentProxy> {
    pdfjsLib ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { getDocument } = pdfjsLib;
    const parameters: DocumentInitParameters = {
        data: pdfFileBuffer,
        cMapUrl: factoryUrl(pdfjsAssetDirectory(PDFJS_ASSET_DIRECTORIES.cmaps)),
        cMapPacked: true,
        standardFontDataUrl: factoryUrl(pdfjsAssetDirectory(PDFJS_ASSET_DIRECTORIES.standardFonts)),
        wasmUrl: factoryUrl(pdfjsAssetDirectory(PDFJS_ASSET_DIRECTORIES.wasm)),
        verbosity: opts.verbosityLevel,
        disableFontFace: opts.disableFontFace,
        useSystemFonts: opts.useSystemFonts,
        enableXfa: opts.enableXfa,
        password: opts.pdfFilePassword,
    };
    const task: PDFDocumentLoadingTask = getDocument(parameters);

    try {
        return await task.promise;
    } catch (error) {
        await task.destroy();
        throw error;
    }
}
