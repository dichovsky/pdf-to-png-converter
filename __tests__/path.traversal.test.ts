import { promises as fsPromises } from 'node:fs';
import { resolve, sep } from 'node:path';
import { expect, test } from 'vitest';
import { resolvePageName } from '../src/pageOrchestrator';
import { savePNGfile } from '../src/outputWriter';
import { pdfToPng } from '../src';

const isWindows = sep === '\\';

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

test('resolvePageName should reject names containing the platform path separator "/"', () => {
    expect(() => resolvePageName(1, 'sample', () => 'sub/page.png')).toThrow('path separator');
});

test.runIf(isWindows)('resolvePageName should reject "\\" on Windows where it is a path separator', () => {
    expect(() => resolvePageName(1, 'sample', () => 'sub\\page.png')).toThrow('path separator');
});

test.skipIf(isWindows)('resolvePageName should accept "\\" on POSIX where it is a valid filename character', () => {
    // PDFs named e.g. `foo\bar.pdf` produce a default mask of `foo\bar` via `path.parse(pdfFile).name`.
    // The SEC-001 guard must not break that legitimate POSIX use case.
    expect(resolvePageName(1, 'sample', () => 'foo\\bar.png')).toBe('foo\\bar.png');
});

test('resolvePageName should accept a flat filename unchanged', () => {
    expect(resolvePageName(1, 'sample', () => 'page.png')).toBe('page.png');
});

test('savePNGfile should reject a name containing "/" before any I/O', async () => {
    await expect(savePNGfile('sub/page.png', Buffer.alloc(0), '/tmp/does-not-matter', '/tmp/does-not-matter')).rejects.toThrow(
        /Output file name must be a flat filename without .* path separators/,
    );
});

test.runIf(isWindows)('savePNGfile should reject "\\" on Windows before any I/O', async () => {
    await expect(savePNGfile('sub\\page.png', Buffer.alloc(0), 'C:\\tmp', 'C:\\tmp')).rejects.toThrow(
        /Output file name must be a flat filename without .* path separators/,
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

test.skipIf(isWindows)('pdfToPng should accept a PDF whose name contains "\\" on POSIX (default mask preserves the char)', async () => {
    // Regression test for PR #142 review: ensure rejecting "\\" as a separator on every platform
    // does not break POSIX conversions where `path.parse(pdfFile).name` legitimately contains "\".
    const resolvedOutputFolder = resolve(outputFolder);
    await fsPromises.rm(resolvedOutputFolder, { recursive: true, force: true });
    await fsPromises.mkdir(resolvedOutputFolder, { recursive: true });
    // Create a copy of sample.pdf at a path whose basename contains "\" on POSIX.
    const tricky = resolve(resolvedOutputFolder, 'foo\\bar.pdf');
    await fsPromises.copyFile(pdfFilePath, tricky);

    const pngPages = await pdfToPng(tricky, {
        outputFolder,
        returnPageContent: false,
        pagesToProcess: [1],
    });
    expect(pngPages).toHaveLength(1);
    expect(pngPages[0].path).toContain('foo\\bar');
    expect(pngPages[0].path.startsWith(resolvedOutputFolder)).toBe(true);
});
