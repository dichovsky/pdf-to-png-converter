import { describe, it, expect } from 'vitest';
import { pdfToPng } from '../src/pdfToPng';
import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

describe('pdfToPng parallel no content', () => {

    it('should not return content when processPagesInParallel is true and returnPageContent is false', async () => {
        const pdfFilePath = 'test-data/sample.pdf';
        const outputFolder = 'test-results/pdf.to.png.parallel.no.content';

        // Clean up or create directory
        await fsPromises.rm(join(process.cwd(), outputFolder), { recursive: true, force: true });
        await fsPromises.mkdir(join(process.cwd(), outputFolder), { recursive: true });

        const result = await pdfToPng(pdfFilePath, {
            outputFolder,
            returnPageContent: false,
            processPagesInParallel: true,
            concurrencyLimit: 2
        });

        expect(result).toBeInstanceOf(Array);
        expect(result.length).toBe(2);
        
        // Check that content is undefined
        expect(result[0].content).toBeUndefined();
        expect(result[1].content).toBeUndefined();

        // Check that files were created
        expect(existsSync(result[0].path)).toBe(true);
        expect(existsSync(result[1].path)).toBe(true);
    });
});
