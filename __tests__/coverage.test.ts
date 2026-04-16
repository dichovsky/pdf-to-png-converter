import { promises as fsPromises } from 'node:fs';
import type { Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';
import * as index from '../src/index';
import { pdfToPng } from '../src/pdfToPng';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

vi.mock('node:fs', () => ({
    promises: {
        readFile: vi.fn(),
        mkdir: vi.fn(),
        writeFile: vi.fn(),
        realpath: vi.fn(),
    },
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
    getDocument: vi.fn(),
}));

describe('index', () => {
    it('should export pdfToPng function', () => {
        expect(index.pdfToPng).toBeDefined();
    });

    it('should export VerbosityLevel enum', () => {
        expect(index.VerbosityLevel).toBeDefined();
        expect(index.VerbosityLevel.ERRORS).toBe(0);
        expect(index.VerbosityLevel.WARNINGS).toBe(1);
        expect(index.VerbosityLevel.INFOS).toBe(5);
    });
});

describe('pdfToPng', () => {
    it('should handle ArrayBuffer from readFile', async () => {
        const pdfPath = '/path/to/sample.pdf';
        const pdfArrayBuffer = new ArrayBuffer(8);
        (fsPromises.readFile as Mock).mockResolvedValue(pdfArrayBuffer);

        try {
            await pdfToPng(pdfPath);
        } catch {
            // We expect an error because the ArrayBuffer is not a valid PDF
        }

        expect(fsPromises.readFile).toHaveBeenCalledWith(pdfPath);
    });

    it('should throw for unsupported buffer type', async () => {
        const pdfPath = '/path/to/sample.pdf';
        (fsPromises.readFile as Mock).mockResolvedValue({} as any);

        await expect(pdfToPng(pdfPath)).rejects.toThrow('Unsupported buffer type');
    });

    it('should throw for viewportScale of NaN', async () => {
        await expect(pdfToPng('test.pdf', { viewportScale: NaN })).rejects.toThrow('viewportScale');
    });

    it('should throw for viewportScale of Infinity', async () => {
        await expect(pdfToPng('test.pdf', { viewportScale: Infinity })).rejects.toThrow('viewportScale');
    });

    it('should throw for viewportScale of -Infinity', async () => {
        await expect(pdfToPng('test.pdf', { viewportScale: -Infinity })).rejects.toThrow('viewportScale');
    });

    it('should throw for viewportScale of 0', async () => {
        await expect(pdfToPng('test.pdf', { viewportScale: 0 })).rejects.toThrow(
            'viewportScale must be a finite number greater than 0 and at most 100, received: 0',
        );
    });

    it('should throw for negative viewportScale', async () => {
        await expect(pdfToPng('test.pdf', { viewportScale: -1 })).rejects.toThrow(
            'viewportScale must be a finite number greater than 0 and at most 100, received: -1',
        );
    });

    it('should throw for viewportScale of 101 (above maximum)', async () => {
        await expect(pdfToPng('test.pdf', { viewportScale: 101 })).rejects.toThrow(
            'viewportScale must be a finite number greater than 0 and at most 100, received: 101',
        );
    });

    it('should throw for viewportScale of 1e6 (extremely large, OOM risk)', async () => {
        await expect(pdfToPng('test.pdf', { viewportScale: 1e6 })).rejects.toThrow(
            'viewportScale must be a finite number greater than 0 and at most 100, received: 1000000',
        );
    });

    it('should not throw for viewportScale of 100 (boundary — maximum valid value)', async () => {
        (fsPromises.readFile as Mock).mockResolvedValueOnce(new ArrayBuffer(8));
        (getDocument as Mock).mockReturnValueOnce({ promise: Promise.reject(new Error('Mock PDF parse error')) });
        // The call fails at PDF parsing — viewportScale validation must not throw first.
        await expect(pdfToPng('test.pdf', { viewportScale: 100 })).rejects.toThrow('Mock PDF parse error');
    });

    it('should not throw for viewportScale of 0.001 (very small but valid)', async () => {
        (fsPromises.readFile as Mock).mockResolvedValueOnce(new ArrayBuffer(8));
        (getDocument as Mock).mockReturnValueOnce({ promise: Promise.reject(new Error('Mock PDF parse error')) });
        // The call fails at PDF parsing — viewportScale validation must not throw first.
        await expect(pdfToPng('test.pdf', { viewportScale: 0.001 })).rejects.toThrow('Mock PDF parse error');
    });

    it('should throw when canvas pixel area exceeds the limit', async () => {
        // A page whose natural dimensions already exceed MAX_CANVAS_PIXELS regardless of scale.
        const mockPage = {
            getViewport: vi.fn().mockReturnValue({ width: 20_000, height: 20_000 }), // 400 MP > 100 MP limit
            rotate: 0,
            cleanup: vi.fn(),
        };
        const mockDocument = {
            numPages: 1,
            getPage: vi.fn().mockResolvedValue(mockPage),
            cleanup: vi.fn(),
            canvasFactory: null,
        };

        (fsPromises.readFile as Mock).mockResolvedValueOnce(new ArrayBuffer(8));
        (getDocument as Mock).mockReturnValueOnce({ promise: Promise.resolve(mockDocument) });

        await expect(pdfToPng('test.pdf')).rejects.toThrow('exceeds the');
        expect(mockPage.cleanup).toHaveBeenCalled();
    });

    it('should throw when outputFolder directory resolves outside outputFolder via symlink (symlink escape on dirname)', async () => {
        // Simulates a symlink swap: the filename is safe-looking but realpath(dirname(file))
        // resolves to a path outside realOutputFolder — L458 in savePNGfile.
        const mockCanvas = { toBuffer: vi.fn().mockReturnValue(Buffer.alloc(0)) };
        const mockCanvasFactory = {
            create: vi.fn().mockReturnValue({ canvas: mockCanvas, context: {} }),
            destroy: vi.fn(),
        };
        const mockPage = {
            getViewport: vi.fn().mockReturnValue({ width: 10, height: 10 }),
            render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
            rotate: 0,
            cleanup: vi.fn(),
        };
        const mockDocument = {
            numPages: 1,
            getPage: vi.fn().mockResolvedValue(mockPage),
            cleanup: vi.fn(),
            canvasFactory: mockCanvasFactory,
        };

        (fsPromises.readFile as Mock).mockResolvedValueOnce(new ArrayBuffer(8));
        (getDocument as Mock).mockReturnValueOnce({ promise: Promise.resolve(mockDocument) });
        (fsPromises.mkdir as Mock).mockResolvedValueOnce(undefined);
        // 1st realpath: resolvedOutputFolder in pdfToPng → establishes realOutputFolder
        // 2nd realpath: dirname(resolvedFilePath) in savePNGfile → escapes (simulates symlink)
        (fsPromises.realpath as Mock).mockResolvedValueOnce('/safe/output').mockResolvedValueOnce('/evil');

        await expect(pdfToPng('/path/to/test.pdf', { outputFolder: 'test-output' })).rejects.toThrow(
            'Output file name escapes the output folder',
        );
        expect(fsPromises.writeFile).not.toHaveBeenCalled();
    });

    it('should throw when content is undefined at write time (defensive guard)', async () => {
        // Simulates canvas.toBuffer() returning undefined (e.g. broken canvas implementation).
        // Guards L463: the savePNGfile defensive check that content must not be undefined.
        const mockCanvas = { toBuffer: vi.fn().mockReturnValue(undefined) };
        const mockCanvasFactory = {
            create: vi.fn().mockReturnValue({ canvas: mockCanvas, context: {} }),
            destroy: vi.fn(),
        };
        const mockPage = {
            getViewport: vi.fn().mockReturnValue({ width: 10, height: 10 }),
            render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
            rotate: 0,
            cleanup: vi.fn(),
        };
        const mockDocument = {
            numPages: 1,
            getPage: vi.fn().mockResolvedValue(mockPage),
            cleanup: vi.fn(),
            canvasFactory: mockCanvasFactory,
        };

        (fsPromises.readFile as Mock).mockResolvedValueOnce(new ArrayBuffer(8));
        (getDocument as Mock).mockReturnValueOnce({ promise: Promise.resolve(mockDocument) });
        (fsPromises.mkdir as Mock).mockResolvedValueOnce(undefined);
        // Both realpath calls return the same safe path so the symlink check (L457) passes;
        // L463 fires before the TOCTOU re-check (L474) is reached.
        (fsPromises.realpath as Mock).mockResolvedValueOnce('/safe/output').mockResolvedValueOnce('/safe/output');

        await expect(pdfToPng('/path/to/test.pdf', { outputFolder: 'test-output' })).rejects.toThrow('Cannot write PNG file');
        expect(fsPromises.writeFile).not.toHaveBeenCalled();
    });

    it('should throw when output folder realpath changes between initial check and final write', async () => {
        // Simulate a TOCTOU swap: realpath returns the same value for the initial containment
        // checks (passes), then a different value for the final re-verification (triggers error).
        const mockCanvas = { toBuffer: vi.fn().mockReturnValue(Buffer.alloc(0)) };
        const mockCanvasFactory = {
            create: vi.fn().mockReturnValue({ canvas: mockCanvas, context: {} }),
            destroy: vi.fn(),
        };
        const mockPage = {
            getViewport: vi.fn().mockReturnValue({ width: 10, height: 10 }),
            render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
            rotate: 0,
            cleanup: vi.fn(),
        };
        const mockDocument = {
            numPages: 1,
            getPage: vi.fn().mockResolvedValue(mockPage),
            cleanup: vi.fn(),
            canvasFactory: mockCanvasFactory,
        };

        (fsPromises.readFile as Mock).mockResolvedValueOnce(new ArrayBuffer(8));
        (getDocument as Mock).mockReturnValueOnce({ promise: Promise.resolve(mockDocument) });
        (fsPromises.mkdir as Mock).mockResolvedValueOnce(undefined);
        // 1st realpath: resolvedOutputFolder in pdfToPng (cached as realOutputFolder) — passes
        // 2nd realpath: dirname(resolvedFilePath) in savePNGfile (symlink containment check) — passes
        // 3rd realpath: resolvedOutputFolder in savePNGfile (final TOCTOU re-check) — differs → throws
        (fsPromises.realpath as Mock)
            .mockResolvedValueOnce('/safe/output')
            .mockResolvedValueOnce('/safe/output')
            .mockResolvedValueOnce('/swapped/evil');

        await expect(pdfToPng('/path/to/test.pdf', { outputFolder: 'test-output' })).rejects.toThrow(
            'Output folder was modified during write',
        );

        expect(fsPromises.writeFile).not.toHaveBeenCalled();
    });
});
