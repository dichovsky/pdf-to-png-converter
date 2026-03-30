import { describe, it, expect } from 'vitest';
import { pdfToPng } from '../src/pdfToPng';

describe('pdfToPng concurrencyLimit validation', () => {
    const pdfFilePath = 'test-data/sample.pdf';

    it('should throw when concurrencyLimit is 0', async () => {
        await expect(
            pdfToPng(pdfFilePath, {
                processPagesInParallel: true,
                concurrencyLimit: 0,
            }),
        ).rejects.toThrow('concurrencyLimit must be a positive integer >= 1, received: 0');
    });

    it('should throw when concurrencyLimit is -1', async () => {
        await expect(
            pdfToPng(pdfFilePath, {
                processPagesInParallel: true,
                concurrencyLimit: -1,
            }),
        ).rejects.toThrow('concurrencyLimit must be a positive integer >= 1, received: -1');
    });

    it('should throw when concurrencyLimit is a negative number', async () => {
        await expect(
            pdfToPng(pdfFilePath, {
                processPagesInParallel: true,
                concurrencyLimit: -100,
            }),
        ).rejects.toThrow('concurrencyLimit must be a positive integer >= 1, received: -100');
    });

    it('should throw when concurrencyLimit is a non-integer', async () => {
        await expect(
            pdfToPng(pdfFilePath, {
                processPagesInParallel: true,
                concurrencyLimit: 1.5,
            }),
        ).rejects.toThrow('concurrencyLimit must be a positive integer >= 1, received: 1.5');
    });

    it('should not throw when concurrencyLimit is 1', async () => {
        const result = await pdfToPng(pdfFilePath, {
            processPagesInParallel: true,
            concurrencyLimit: 1,
        });
        expect(result).toBeInstanceOf(Array);
        expect(result.length).toBeGreaterThan(0);
    });

    it('should not throw when concurrencyLimit is a valid positive integer', async () => {
        const result = await pdfToPng(pdfFilePath, {
            processPagesInParallel: true,
            concurrencyLimit: 4,
        });
        expect(result).toBeInstanceOf(Array);
        expect(result.length).toBeGreaterThan(0);
    });
});
