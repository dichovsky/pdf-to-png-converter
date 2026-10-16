import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type * as PdfjsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import { PDFJS_ASSET_DIRECTORIES, PDFJS_WASM_DECODER_FILES, WASM_WARM_UP_TIMEOUT_MS } from './const.js';
import type { PdfjsAssetDirectory } from './const.js';
import { VerbosityLevel } from './types.js';

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
 *
 * Use the module's own `require.resolve`, not `createRequire(__filename)`: ESM bundlers shim `require` but leave
 * `__filename` undefined, so the error message reads it only behind a `typeof` guard.
 */
function locatePdfjsPackageRoot(): string {
    try {
        return dirname(require.resolve('pdfjs-dist/package.json'));
    } catch (error) {
        const searchedFrom = typeof __filename === 'string' ? __filename : 'pdf-to-png-converter';
        throw new Error(
            `Cannot resolve "pdfjs-dist/package.json" from "${searchedFrom}". ` +
                'pdf-to-png-converter reads the pdf.js cmaps, standard_fonts and wasm folders from the installed pdfjs-dist package, ' +
                'so that package must be resolvable from this file. Check for a bundler that inlines pdfjs-dist, ' +
                'a pdfjs-dist "exports" map without "./package.json", or an incomplete install.',
            { cause: error },
        );
    }
}

/**
 * Absolute filesystem path of an asset directory inside the installed pdfjs-dist package.
 * The package root is located once, so asset lookup does not depend on the process working directory
 * or on `node_modules` sitting in `process.cwd()`.
 */
export function pdfjsAssetDirectory(directory: PdfjsAssetDirectory): string {
    pdfjsPackageRoot ??= locatePdfjsPackageRoot();
    return join(pdfjsPackageRoot, directory);
}

/**
 * Emits one process warning when the pdf.js wasm decoders are absent. The "already checked" state is module-level,
 * so a thread warns at most once; the library calls this on the main thread only, which makes it once per process
 * unless the caller runs `pdfToPng()` in its own worker threads (each has its own module instance and warns once).
 * Without a decoder file pdf.js tries its slower JavaScript fallback where that is available, and otherwise swallows the
 * decode failure and renders the image blank, so without this a damaged install is silent below verbosity 1.
 * It checks that the files exist; it cannot detect decode errors.
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
                'Images that use CCITT or JBIG2 (jbig2.wasm) or JPEG 2000 (openjpeg.wasm) compression may render blank, ' +
                'or decode more slowly through the pdf.js JavaScript fallback where it is available.',
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
 * accepts this plain path form, but its JavaScript fallback (`*_nowasm_fallback.js`) loads through `import()`,
 * which rejects `C:/...` on Windows and also fails on POSIX install paths that contain `#`, `?` or `%`. The
 * `fs.readFile` of the `.wasm` files is unaffected, so this matters only when the wasm load itself fails (for
 * example under `node --jitless`). A `file:///` URL would flip the two. A duck-typed `BinaryDataFactory` could fix
 * both: it is a public `getDocument` option, and pdf.js only calls `new Factory({ cMapUrl, standardFontDataUrl,
 * wasmUrl })` and `factory.fetch({ kind, filename })` on it, so it could read the files from disk while the URLs
 * are `file://` URLs for the fallback `import()`. That is deferred as a follow-up (`BACKLOG.md` ARCH-017).
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

let wasmDecodersWarmUp: Promise<void> | undefined;

/**
 * Works around mozilla/pdf.js#22131 (issue #288), present up to pdfjs-dist 6.4.299. pdf.js fetches every wasm decoder
 * through the message handler of the document opened most recently. Once that document is destroyed, the first CCITT,
 * JBIG2 or JPEG 2000 decode in any other open document waits forever. pdf.js keeps the wasm bytes for the rest of the
 * thread once a fetch succeeds, so this decodes both kinds of image once, in a document opened while no other is open.
 *
 * `pdfToPng()` awaits it before every main-thread `getPdfDocument()` call. Worker threads open one document each and
 * skip it. A failed warm-up is ignored: the caller's conversion then reports its own outcome, and only this protection
 * is lost. A warm-up still pending after `WASM_WARM_UP_TIMEOUT_MS` stops blocking conversions, so other pdf.js use in
 * the same thread that stalls it cannot hang every conversion. Remove it once pdfjs-dist includes mozilla/pdf.js#22145
 * (BACKLOG.md ARCH-018).
 */
export function warmUpWasmDecoders(): Promise<void> {
    wasmDecodersWarmUp ??= new Promise<void>((settle) => {
        const timer = setTimeout(settle, WASM_WARM_UP_TIMEOUT_MS);
        const done = (): void => {
            clearTimeout(timer);
            settle();
        };
        void decodeWarmUpImages().then(done, done);
    });
    return wasmDecodersWarmUp;
}

async function decodeWarmUpImages(): Promise<void> {
    const pdfDocument = await getPdfDocument(buildWasmWarmUpPdf(), {
        disableFontFace: true,
        useSystemFonts: false,
        enableXfa: false,
        pdfFilePassword: undefined,
        verbosityLevel: VerbosityLevel.ERRORS,
    });
    try {
        await (await pdfDocument.getPage(1)).getOperatorList();
    } finally {
        await pdfDocument.loadingTask.destroy();
    }
}

/**
 * A one-page PDF with two 8x8 inline images, one per wasm decoder: CCITT Group 4 for `jbig2.wasm` (all white: eight V0
 * codes, then EOFB) and JPEG 2000 for `openjpeg.wasm` (one empty packet, so it decodes to flat gray). pdf.js decodes
 * inline images this small while it builds the operator list, so `getOperatorList()` settles only after both decoders
 * have fetched their wasm. Images in XObjects decode after the operator list settles, which is too late.
 */
function buildWasmWarmUpPdf(): Uint8Array {
    const ccittG4 = Buffer.from('ff001001', 'hex');
    const jpx = Buffer.from(
        'ff4f' + // SOC
            'ff510029000000000008000000080000000000000000000000080000000800000000000000000001070101' + // SIZ: 8x8, one 8-bit component
            'ff52000c00000001000004040001' + // COD: one layer, no wavelet decomposition
            'ff5c00044040' + // QCD
            'ff90000a00000000000f0001' + // SOT
            'ff9300' + // SOD and one empty packet
            'ffd9', // EOC
        'hex',
    );
    const content = Buffer.concat([
        Buffer.from('BI /W 8 /H 8 /BPC 1 /CS /G /F /CCF /DP << /K -1 /Columns 8 /Rows 8 >> ID '),
        ccittG4,
        Buffer.from(' EI\nBI /W 8 /H 8 /BPC 8 /CS /G /F /JPXDecode ID '),
        jpx,
        Buffer.from(' EI\n'),
    ]);
    const objects = [
        Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
        Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
        Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 8 8] /Contents 4 0 R >>'),
        Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]),
    ].map((body, index) => Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]));
    const header = Buffer.from('%PDF-1.7\n');
    const offsets = objects.map((_, index) => header.length + Buffer.concat(objects.slice(0, index)).length);
    const trailer =
        `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${header.length + Buffer.concat(objects).length}\n%%EOF\n`;
    return new Uint8Array(Buffer.concat([header, ...objects, Buffer.from(trailer)]));
}
