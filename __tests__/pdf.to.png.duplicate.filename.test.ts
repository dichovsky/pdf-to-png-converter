import { promises as fsPromises } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { pdfToPng } from '../src/pdfToPng';

const pdfFilePath: string = resolve('./test-data/sample.pdf');
const multiPagePdfFilePath: string = resolve('./test-data/large_pdf.pdf');
const baseOutputFolder: string = resolve('./test-results/duplicate-filename');

async function pngFilesIn(folder: string): Promise<string[]> {
    try {
        const entries = await fsPromises.readdir(folder);
        return entries.filter((entry) => entry.endsWith('.png'));
    } catch {
        return [];
    }
}

beforeEach(async () => {
    await fsPromises.rm(baseOutputFolder, { recursive: true, force: true });
});

afterAll(async () => {
    await fsPromises.rm(baseOutputFolder, { recursive: true, force: true });
});

describe('VAL-001: duplicate output filename pre-flight check', () => {
    test('(a) duplicate pagesToProcess + outputFolder throws a clear error and writes no files', async () => {
        const outputFolder = join(baseOutputFolder, 'dup-pages');
        // Pre-create the folder so the assertion proves we did not write despite it existing.
        await fsPromises.mkdir(outputFolder, { recursive: true });

        await expect(pdfToPng(pdfFilePath, { outputFolder, pagesToProcess: [1, 1] })).rejects.toThrow(
            /Duplicate output filename "sample_page_1\.png" for pages 1, 1\./,
        );

        expect(await pngFilesIn(outputFolder)).toHaveLength(0);
    });

    test('(b) non-injective outputFileMaskFunc over multiple pages throws and writes no files', async () => {
        const outputFolder = join(baseOutputFolder, 'non-injective');
        await fsPromises.mkdir(outputFolder, { recursive: true });

        await expect(
            pdfToPng(pdfFilePath, {
                outputFolder,
                outputFileMaskFunc: () => 'same.png',
                pagesToProcess: [1, 2],
            }),
        ).rejects.toThrow(/Duplicate output filename "same\.png" for pages 1, 2\./);

        expect(await pngFilesIn(outputFolder)).toHaveLength(0);
    });

    test('(c) regression: injective custom mask with dup-free pages still succeeds', async () => {
        const outputFolder = join(baseOutputFolder, 'injective-ok');

        const pages = await pdfToPng(pdfFilePath, {
            outputFolder,
            outputFileMaskFunc: (pageNumber: number) => `custom_${pageNumber}.png`,
            pagesToProcess: [1, 2],
        });

        expect(pages).toHaveLength(2);
        expect(pages.map((page) => page.name)).toEqual(['custom_1.png', 'custom_2.png']);
        expect(await pngFilesIn(outputFolder)).toHaveLength(2);
    });

    test('(d) parallel mode raises the same deterministic error', async () => {
        const outputFolder = join(baseOutputFolder, 'parallel');
        await fsPromises.mkdir(outputFolder, { recursive: true });

        await expect(
            pdfToPng(pdfFilePath, {
                outputFolder,
                outputFileMaskFunc: () => 'same.png',
                pagesToProcess: [1, 2],
                processPagesInParallel: true,
            }),
        ).rejects.toThrow(/Duplicate output filename "same\.png" for pages 1, 2\./);

        expect(await pngFilesIn(outputFolder)).toHaveLength(0);
    });

    test('(e) error message does not leak the absolute output path', async () => {
        const outputFolder = join(baseOutputFolder, 'no-path-leak');

        let message = '';
        try {
            await pdfToPng(pdfFilePath, { outputFolder, pagesToProcess: [1, 1] });
        } catch (error: unknown) {
            message = error instanceof Error ? error.message : String(error);
        }

        expect(message).toMatch(/Duplicate output filename/);
        expect(message).not.toContain(outputFolder);
        expect(message).not.toContain(process.cwd());
    });

    test('(f) gating: duplicate names with no outputFolder (in-memory) do not throw', async () => {
        const pages = await pdfToPng(pdfFilePath, {
            outputFileMaskFunc: () => 'same.png',
            pagesToProcess: [1, 2],
        });

        expect(pages).toHaveLength(2);
        expect(pages.every((page) => page.name === 'same.png')).toBe(true);
        expect(pages.every((page) => page.path === '')).toBe(true);
    });

    test('(g) non-adjacent colliding pages are reported with the correct page list', async () => {
        const outputFolder = join(baseOutputFolder, 'non-adjacent');
        await fsPromises.mkdir(outputFolder, { recursive: true });

        // Pages 1 and 3 collide on "collide.png"; page 2 is distinct. The reported page list
        // must list the non-adjacent colliding pages (1, 3), not the distinct page 2.
        await expect(
            pdfToPng(multiPagePdfFilePath, {
                outputFolder,
                outputFileMaskFunc: (pageNumber: number) => (pageNumber === 2 ? 'unique_2.png' : 'collide.png'),
                pagesToProcess: [1, 2, 3],
            }),
        ).rejects.toThrow(/Duplicate output filename "collide\.png" for pages 1, 3\./);

        expect(await pngFilesIn(outputFolder)).toHaveLength(0);
    });

    test('(h) names differing only in case collide on case-insensitive filesystems and are rejected before any write', async () => {
        const outputFolder = join(baseOutputFolder, 'case-collision');
        await fsPromises.mkdir(outputFolder, { recursive: true });

        // "Page.png" and "page.png" are distinct strings but the SAME file on case-insensitive,
        // case-preserving filesystems (macOS APFS, Windows NTFS — the default dev environments).
        // The pre-flight check must reject them with the clean VAL-001 error on every platform,
        // not let the second exclusive-create ('wx') write fail with a raw EEXIST that leaks the
        // absolute output path and leaves the first file behind.
        await expect(
            pdfToPng(multiPagePdfFilePath, {
                outputFolder,
                outputFileMaskFunc: (pageNumber: number) => (pageNumber === 1 ? 'Page.png' : 'page.png'),
                pagesToProcess: [1, 2],
            }),
        ).rejects.toThrow(/Duplicate output filename "Page\.png" for pages 1, 2\./);

        expect(await pngFilesIn(outputFolder)).toHaveLength(0);
    });

    test('(i) case-collision error does not leak the absolute output path', async () => {
        const outputFolder = join(baseOutputFolder, 'case-no-leak');

        let message = '';
        try {
            await pdfToPng(multiPagePdfFilePath, {
                outputFolder,
                outputFileMaskFunc: (pageNumber: number) => (pageNumber === 1 ? 'Page.png' : 'page.png'),
                pagesToProcess: [1, 2],
            });
        } catch (error: unknown) {
            message = error instanceof Error ? error.message : String(error);
        }

        expect(message).toMatch(/Duplicate output filename/);
        expect(message).not.toContain(outputFolder);
        expect(message).not.toContain(process.cwd());
    });

    test('(j) gating: case-only-differing names with no outputFolder (in-memory) do not throw', async () => {
        const pages = await pdfToPng(pdfFilePath, {
            outputFileMaskFunc: (pageNumber: number) => (pageNumber === 1 ? 'Page.png' : 'page.png'),
            pagesToProcess: [1, 2],
        });

        expect(pages).toHaveLength(2);
        expect(pages.map((page) => page.name)).toEqual(['Page.png', 'page.png']);
        expect(pages.every((page) => page.path === '')).toBe(true);
    });
});
