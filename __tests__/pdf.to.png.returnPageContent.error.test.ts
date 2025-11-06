import { describe, it, expect } from 'vitest';
import { pdfToPng } from '../src/pdfToPng';
import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';

describe('pdfToPng returnPageContent with outputFolder', () => {
    it('should throw an error when returnPageContent is false and outputFolder is provided', async () => {
        const pdfFilePath = 'test-data/sample.pdf';
        const outputFolder = 'test-results/pdf.to.png.returnPageContent.false.with.outputFolder';

        await fsPromises.mkdir(join(process.cwd(), outputFolder), { recursive: true });

        await expect(pdfToPng(pdfFilePath, {
            outputFolder,
            returnPageContent: false,
        })).rejects.toThrow(/Cannot write PNG file .* because content is undefined\./);
    });
});
