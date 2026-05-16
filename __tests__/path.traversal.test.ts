import { promises as fsPromises } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { resolvePageName } from '../src/pageOrchestrator';
import { savePNGfile } from '../src/outputWriter';
import { pdfToPng } from '../src';

const pdfFilePath: string = resolve('./test-data/sample.pdf');
const outputFolder: string = './test-results/path-traversal-guard';

test('should reject outputFileMaskFunc returning a path-traversal filename', async () => {
    await fsPromises.rm(resolve(outputFolder), { recursive: true, force: true });
    await expect(
        pdfToPng(pdfFilePath, {
            outputFolder,
            outputFileMaskFunc: () => '../../evil.png',
        }),
    ).rejects.toThrow(/path separator|escapes the output folder/);
});

test('should reject outputFileMaskFunc returning an absolute path outside outputFolder', async () => {
    const absolutePathOutside = resolve(outputFolder, '..', 'evil.png');
    await fsPromises.rm(resolve(outputFolder), { recursive: true, force: true });
    await expect(
        pdfToPng(pdfFilePath, {
            outputFolder,
            outputFileMaskFunc: () => absolutePathOutside,
        }),
    ).rejects.toThrow(/path separator|escapes the output folder/);
});

test('should accept outputFileMaskFunc returning a filename starting with .. (not a traversal)', async () => {
    const resolvedOutputFolder = resolve(outputFolder);
    await fsPromises.rm(resolvedOutputFolder, { recursive: true, force: true });
    const pngPages = await pdfToPng(pdfFilePath, {
        outputFolder,
        outputFileMaskFunc: (pageNumber: number) => `..evil_page_${pageNumber}.png`,
        returnPageContent: false,
    });

    expect(pngPages.length).toBeGreaterThan(0);
    for (const pngPage of pngPages) {
        expect(pngPage.path.startsWith(resolvedOutputFolder)).toBe(true);
    }
});

test('should accept outputFileMaskFunc returning a safe filename', async () => {
    const resolvedOutputFolder = resolve(outputFolder);
    await fsPromises.rm(resolvedOutputFolder, { recursive: true, force: true });
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

test('resolvePageName should reject names containing a POSIX path separator', () => {
    expect(() => resolvePageName(1, 'sample', () => 'sub/page.png')).toThrow('path separator');
});

test('resolvePageName should reject names containing a Windows path separator on every platform', () => {
    expect(() => resolvePageName(1, 'sample', () => 'sub\\page.png')).toThrow('path separator');
});

test('resolvePageName should accept a flat filename unchanged', () => {
    expect(resolvePageName(1, 'sample', () => 'page.png')).toBe('page.png');
});

test('savePNGfile should reject a name containing a POSIX path separator before any I/O', async () => {
    await expect(savePNGfile('sub/page.png', Buffer.alloc(0), '/tmp/does-not-matter', '/tmp/does-not-matter')).rejects.toThrow(
        'Output file name must be a flat filename without path separators',
    );
});

test('savePNGfile should reject a name containing a Windows path separator before any I/O', async () => {
    await expect(savePNGfile('sub\\page.png', Buffer.alloc(0), '/tmp/does-not-matter', '/tmp/does-not-matter')).rejects.toThrow(
        'Output file name must be a flat filename without path separators',
    );
});

test('pdfToPng should reject outputFileMaskFunc returning a subdirectory filename', async () => {
    await fsPromises.rm(resolve(outputFolder), { recursive: true, force: true });
    await expect(
        pdfToPng(pdfFilePath, {
            outputFolder,
            outputFileMaskFunc: () => 'sub/page.png',
        }),
    ).rejects.toThrow('path separator');
});
