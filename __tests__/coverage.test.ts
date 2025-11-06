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
    },
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
    getDocument: vi.fn(),
}));

describe('index', () => {
    it('should export pdfToPng function', () => {
        expect(index.pdfToPng).toBeDefined();
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
});
