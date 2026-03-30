import { promises as fsPromises } from 'node:fs';
import type { Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';
import * as index from '../src/index';
import { pdfToPng } from '../src/pdfToPng';

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

    it('should throw for viewportScale of 0', async () => {
        await expect(pdfToPng('test.pdf', { viewportScale: 0 })).rejects.toThrow(
            'viewportScale must be a finite number greater than 0 and at most 1000, received: 0',
        );
    });

    it('should throw for negative viewportScale', async () => {
        await expect(pdfToPng('test.pdf', { viewportScale: -1 })).rejects.toThrow(
            'viewportScale must be a finite number greater than 0 and at most 1000, received: -1',
        );
    });

    it('should throw for viewportScale of 1001 (above maximum)', async () => {
        await expect(pdfToPng('test.pdf', { viewportScale: 1001 })).rejects.toThrow(
            'viewportScale must be a finite number greater than 0 and at most 1000, received: 1001',
        );
    });

    it('should throw for viewportScale of 1e6 (extremely large, OOM risk)', async () => {
        await expect(pdfToPng('test.pdf', { viewportScale: 1e6 })).rejects.toThrow(
            'viewportScale must be a finite number greater than 0 and at most 1000, received: 1000000',
        );
    });

    it('should not throw for viewportScale of 1000 (boundary — maximum valid value)', async () => {
        (fsPromises.readFile as Mock).mockResolvedValue(new ArrayBuffer(8));
        // The call will ultimately fail when trying to parse an empty ArrayBuffer as a PDF,
        // but the viewportScale validation itself must not throw.
        await expect(pdfToPng('test.pdf', { viewportScale: 1000 })).rejects.not.toThrow(
            'viewportScale must be a finite number greater than 0 and at most 1000, received: 1000',
        );
    });

    it('should not throw for viewportScale of 0.001 (very small but valid)', async () => {
        (fsPromises.readFile as Mock).mockResolvedValue(new ArrayBuffer(8));
        // The call will ultimately fail when trying to parse an empty ArrayBuffer as a PDF,
        // but the viewportScale validation itself must not throw.
        await expect(pdfToPng('test.pdf', { viewportScale: 0.001 })).rejects.not.toThrow(
            'viewportScale must be a finite number greater than 0 and at most 1000, received: 0.001',
        );
    });
});
