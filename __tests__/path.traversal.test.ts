import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { pdfToPng } from '../src';

const pdfFilePath: string = resolve('./test-data/sample.pdf');
const outputFolder: string = './test-results/path-traversal-guard';

test('should reject outputFileMaskFunc returning a path-traversal filename', async () => {
    await expect(
        pdfToPng(pdfFilePath, {
            outputFolder,
            outputFileMaskFunc: () => '../../evil.png',
        }),
    ).rejects.toThrow('Output file name escapes the output folder');
});

test('should reject outputFileMaskFunc returning an absolute path outside outputFolder', async () => {
    const absolutePathOutside = resolve(outputFolder, '..', 'evil.png');
    await expect(
        pdfToPng(pdfFilePath, {
            outputFolder,
            outputFileMaskFunc: () => absolutePathOutside,
        }),
    ).rejects.toThrow('Output file name escapes the output folder');
});

test('should accept outputFileMaskFunc returning a safe filename', async () => {
    const resolvedOutputFolder = resolve(outputFolder);
    const pngPages = await pdfToPng(pdfFilePath, {
        outputFolder,
        outputFileMaskFunc: (pageNumber: number) => `safe_page_${pageNumber}.png`,
        returnPageContent: false,
    });

    expect(pngPages.length).toBeGreaterThan(0);
    for (const pngPage of pngPages) {
        expect(pngPage.path).toContain('safe_page_');
        expect(pngPage.path.startsWith(resolvedOutputFolder)).toBe(true);
    }
});
