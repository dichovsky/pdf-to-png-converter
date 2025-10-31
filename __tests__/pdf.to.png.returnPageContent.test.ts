import { describe, it, expect } from 'vitest';
import { pdfToPng } from '../src/pdfToPng';
import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';

describe('pdfToPng returnPageContent', () => {

    it('should return content when returnPageContent is true', async () => {
        const pdfFilePath = 'test-data/sample.pdf';
        const outputFolder = 'test-results/pdf.to.png.returnPageContent.true';

        await fsPromises.mkdir(join(process.cwd(), outputFolder), { recursive: true });

        const result = await pdfToPng(pdfFilePath, {
            outputFolder,
            returnPageContent: true,
        });

        expect(result).toBeInstanceOf(Array);
        expect(result.length).toBe(2);
        expect(result[0].content).toBeInstanceOf(Buffer);
        expect(result[1].content).toBeInstanceOf(Buffer);
    });

    it('should return content when returnPageContent is not provided', async () => {
        const pdfFilePath = 'test-data/sample.pdf';
        const outputFolder = 'test-results/pdf.to.png.returnPageContent.undefined';

        await fsPromises.mkdir(join(process.cwd(), outputFolder), { recursive: true });

        const result = await pdfToPng(pdfFilePath, {
            outputFolder,
        });

        expect(result).toBeInstanceOf(Array);
        expect(result.length).toBe(2);
        expect(result[0].content).toBeInstanceOf(Buffer);
        expect(result[1].content).toBeInstanceOf(Buffer);
    });
});
