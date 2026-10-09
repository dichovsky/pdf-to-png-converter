import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { pdfToPng } from '../src/pdfToPng.js';
import { warnIfWasmDecodersMissing } from '../src/pdfjsLoader.js';
import { controlPdf, FLATE_ONE_BIT_PDF } from './wasmFixtures';

vi.mock('../src/pdfjsLoader.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/pdfjsLoader.js')>();
    return { ...actual, warnIfWasmDecodersMissing: vi.fn(actual.warnIfWasmDecodersMissing) };
});

/**
 * pdfToPng() runs the once-per-process wasm decoder check on the main thread after the metadata-only early return
 * and before any output folder is prepared (issue #278). The check itself is tested in pdfjs.loader.wasm.warning.test.ts.
 */

const warnSpy = vi.mocked(warnIfWasmDecodersMissing);
const temporaryDirectories: string[] = [];

beforeEach(() => {
    warnSpy.mockClear();
});

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});

describe('wasm decoder check call site', () => {
    test('is not called for a metadata-only request, which decodes no image', async () => {
        const pages = await pdfToPng(FLATE_ONE_BIT_PDF, { returnMetadataOnly: true });

        expect(pages[0].kind).toBe('metadata');
        expect(warnSpy).not.toHaveBeenCalled();
    });

    test('is called once by a normal render', async () => {
        const pages = await pdfToPng(FLATE_ONE_BIT_PDF);

        expect(pages[0].kind).toBe('content');
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    test('is called once per conversion, not once per page', async () => {
        const pages = await pdfToPng(controlPdf('mixed-pages'), { processPagesInParallel: true, concurrencyLimit: 4 });

        expect(pages).toHaveLength(8);
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    test('runs before the output folder is prepared', async () => {
        const base = mkdtempSync(join(tmpdir(), 'pdf-to-png-wasm-check-'));
        temporaryDirectories.push(base);
        const outputFolder = join(base, 'never-created');
        warnSpy.mockImplementationOnce(() => {
            throw new Error('decoder check failed');
        });

        await expect(pdfToPng(FLATE_ONE_BIT_PDF, { outputFolder })).rejects.toThrow('decoder check failed');

        expect(existsSync(outputFolder)).toBe(false);
    });
});
