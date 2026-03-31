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
            returnMetadataOnly: true,
            pagesToProcess: [1],
        });
        expect(result).toBeInstanceOf(Array);
        expect(result.length).toBeGreaterThan(0);
    });

    it('should not throw when concurrencyLimit is a valid positive integer', async () => {
        const result = await pdfToPng(pdfFilePath, {
            processPagesInParallel: true,
            concurrencyLimit: 4,
            returnMetadataOnly: true,
            pagesToProcess: [1],
        });
        expect(result).toBeInstanceOf(Array);
        expect(result.length).toBeGreaterThan(0);
    });

    it('should return all pages when concurrencyLimit is 1 on a multi-page PDF', async () => {
        // concurrencyLimit: 1 forces one page per batch — exercises the slice loop boundary
        const result = await pdfToPng(pdfFilePath, {
            processPagesInParallel: true,
            concurrencyLimit: 1,
            returnMetadataOnly: true,
        });
        expect(result.length).toBe(2); // sample.pdf has 2 pages
        expect(result[0].pageNumber).toBe(1);
        expect(result[1].pageNumber).toBe(2);
    });

    it('should return all pages when concurrencyLimit exceeds the page count', async () => {
        // concurrencyLimit: 100 on a 2-page PDF — entire PDF fits in a single batch
        const result = await pdfToPng(pdfFilePath, {
            processPagesInParallel: true,
            concurrencyLimit: 100,
            returnMetadataOnly: true,
        });
        expect(result.length).toBe(2); // sample.pdf has 2 pages
        expect(result[0].pageNumber).toBe(1);
        expect(result[1].pageNumber).toBe(2);
    });

    it('should return one page when processPagesInParallel is true with a single page requested', async () => {
        // Single page in parallel mode — batch has exactly one element
        const result = await pdfToPng(pdfFilePath, {
            processPagesInParallel: true,
            returnMetadataOnly: true,
            pagesToProcess: [1],
        });
        expect(result.length).toBe(1);
        expect(result[0].pageNumber).toBe(1);
    });
});
