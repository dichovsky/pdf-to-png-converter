import { promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { pdfToPng } from '../src';

test('should write to absolute and relative output folders exactly as requested', async () => {
    const pdfFilePath = resolve('./test-data/sample.pdf');
    const absoluteOutputFolder = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-absolute-'));
    const relativeOutputFolder = 'test-results/pdf.to.png.absolute.output.folder';
    const resolvedRelativeOutputFolder = resolve(relativeOutputFolder);

    await fsPromises.rm(resolvedRelativeOutputFolder, { recursive: true, force: true });

    try {
        const absolutePages = await pdfToPng(pdfFilePath, {
            outputFolder: absoluteOutputFolder,
            returnPageContent: false,
        });
        const relativePages = await pdfToPng(pdfFilePath, {
            outputFolder: relativeOutputFolder,
            returnPageContent: false,
        });

        expect(absolutePages.length).toBeGreaterThan(0);
        expect(relativePages.length).toBeGreaterThan(0);

        for (const page of absolutePages) {
            expect(page.path.startsWith(absoluteOutputFolder)).toBe(true);
            await expect(fsPromises.access(page.path)).resolves.toBeUndefined();
        }

        for (const page of relativePages) {
            expect(page.path.startsWith(resolvedRelativeOutputFolder)).toBe(true);
            await expect(fsPromises.access(page.path)).resolves.toBeUndefined();
        }
    } finally {
        await fsPromises.rm(absoluteOutputFolder, { recursive: true, force: true });
        await fsPromises.rm(resolvedRelativeOutputFolder, { recursive: true, force: true });
    }
});
