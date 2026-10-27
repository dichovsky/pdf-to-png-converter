import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import type { PdfToPngOptions } from '../src/types.js';

/**
 * `disableFontFace: false` is ignored (see core.disable.font.face.test.ts), so the caller is told once per process through
 * process warning PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED. The flag is module state, hence a fresh module per test, as in
 * pdfjs.loader.wasm.warning.test.ts. Nothing here reaches pdf.js: every conversion points at a missing input file.
 */

const missingInput = join(tmpdir(), 'pdf-to-png-core-font-face', 'does-not-exist.pdf');
let emitWarning: MockInstance<typeof process.emitWarning>;

beforeEach(() => {
    vi.resetModules();
    emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
});

function loadConverter(): Promise<typeof import('../src/pdfToPng.js')> {
    return import('../src/pdfToPng.js');
}

describe('process warning for an ignored disableFontFace: false', () => {
    test('is emitted once per process, with a stable code and the reason', async () => {
        const { assertValidPdfToPngOptions, pdfToPng } = await loadConverter();

        expect(assertValidPdfToPngOptions({ disableFontFace: false }).disableFontFace).toBe(true);
        expect(assertValidPdfToPngOptions({ disableFontFace: false }).disableFontFace).toBe(true);
        await expect(pdfToPng(missingInput, { disableFontFace: false })).rejects.toThrow(/ENOENT/);

        expect(emitWarning).toHaveBeenCalledOnce();
        const [message, options] = emitWarning.mock.calls[0] as [string, { code: string }];
        expect(options).toEqual({ code: 'PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED' });
        expect(message).toMatch(/disableFontFace: false is ignored/);
        expect(message).toMatch(/Font Loading API/);
    });

    test('is emitted by pdfToPng() itself, before any input is read', async () => {
        const { pdfToPng } = await loadConverter();

        await expect(pdfToPng(missingInput, { disableFontFace: false })).rejects.toThrow(/ENOENT/);

        expect(emitWarning).toHaveBeenCalledOnce();
    });

    test.each<[string, PdfToPngOptions | undefined]>([
        ['no options', undefined],
        ['an empty options object', {}],
        ['disableFontFace undefined', { disableFontFace: undefined }],
        ['disableFontFace null', { disableFontFace: null } as unknown as PdfToPngOptions],
        ['disableFontFace true', { disableFontFace: true }],
    ])('is not emitted for %s', async (_label, options) => {
        const { assertValidPdfToPngOptions } = await loadConverter();

        expect(assertValidPdfToPngOptions(options).disableFontFace).toBe(true);

        expect(emitWarning).not.toHaveBeenCalled();
    });
});
