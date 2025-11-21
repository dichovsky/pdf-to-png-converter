import { describe, it, expect } from 'vitest';
import { pdfToPng } from '../src/pdfToPng';
import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';

describe('pdfToPng returnPageContent with outputFolder', () => {
    it('should not throw an error when returnPageContent is false and outputFolder is provided', async () => {
        const pdfFilePath = 'test-data/sample.pdf';
        const outputFolder = 'test-results/pdf.to.png.returnPageContent.false.with.outputFolder';

        await fsPromises.mkdir(join(process.cwd(), outputFolder), { recursive: true });

        const pngPages = await pdfToPng(pdfFilePath, {
            outputFolder,
            returnPageContent: false,
        });

        expect(pngPages).toHaveLength(2);
        expect(pngPages[0].content).toBeUndefined();
        expect(pngPages[0].path).toBeDefined();
        expect(pngPages[0].path).not.toBe('');
    });
});
