import { join } from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as pdfjsLoader from '../src/pdfjsLoader.js';
import { pdfToPng } from '../src/pdfToPng.js';
import * as workerPool from '../src/workerPool.js';

/**
 * pdf.js has no Font Loading API in Node.js, so `disableFontFace: false` makes it draw embedded-font text as missing-glyph
 * boxes (silently, exit code 0). The option is still accepted for compatibility, but its value is ignored: pdf.js always
 * gets `true`, on the main thread and in the workers alike.
 */

const getDocumentCalls = vi.hoisted(() => [] as DocumentInitParameters[]);

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>();
    return {
        ...actual,
        getDocument: (parameters: DocumentInitParameters) => {
            getDocumentCalls.push(parameters);
            return actual.getDocument(parameters);
        },
    };
});

const samplePdf = join(__dirname, '..', 'test-data', 'sample.pdf');

beforeEach(() => {
    // The ignored-option warning is covered in core.disable.font.face.warning.test.ts; keep it out of this run's output.
    vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
});

afterEach(() => {
    getDocumentCalls.length = 0;
    vi.restoreAllMocks();
});

describe('disableFontFace: false is ignored', () => {
    test('the pdf.js getDocument parameter is true when the caller passes false', async () => {
        await pdfToPng(samplePdf, { disableFontFace: false, returnMetadataOnly: true, pagesToProcess: [1] });

        expect(getDocumentCalls.length).toBeGreaterThan(0);
        expect(getDocumentCalls.map((parameters) => parameters.disableFontFace)).not.toContain(false);
        expect(getDocumentCalls.at(-1)?.disableFontFace).toBe(true);
    });

    test('the pdf.js getDocument parameter stays true when the caller passes true or nothing', async () => {
        await pdfToPng(samplePdf, { disableFontFace: true, returnMetadataOnly: true, pagesToProcess: [1] });
        await pdfToPng(samplePdf, { returnMetadataOnly: true, pagesToProcess: [1] });

        expect(getDocumentCalls.map((parameters) => parameters.disableFontFace)).not.toContain(false);
        expect(getDocumentCalls.at(-1)?.disableFontFace).toBe(true);
    });

    test('embedded-font text renders exactly as it does by default', async () => {
        const [byDefault] = await pdfToPng(samplePdf, { pagesToProcess: [1] });
        const [ignored] = await pdfToPng(samplePdf, { pagesToProcess: [1], disableFontFace: false });

        expect(Buffer.compare(ignored.content as Buffer, byDefault.content as Buffer)).toBe(0);
    });

    test('the worker pool is given disableFontFace true as well', async () => {
        vi.spyOn(pdfjsLoader, 'getPdfDocument').mockResolvedValue({
            numPages: 1,
            loadingTask: { destroy: vi.fn().mockResolvedValue(undefined) },
        } as unknown as PDFDocumentProxy);
        const pool = vi.spyOn(workerPool, 'renderPagesInWorkerPool').mockResolvedValue(undefined);

        await pdfToPng(new Uint8Array([1]), { renderInWorkerThreads: true, disableFontFace: false, pagesToProcess: [1] });

        expect(pool).toHaveBeenCalledOnce();
        expect(pool.mock.calls[0][1]).toMatchObject({ disableFontFace: true });
    });
});
