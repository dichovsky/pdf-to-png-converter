import { promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import type { PdfToPngOptions } from '../src/interfaces/pdf.to.png.options.js';
import { resolvePageName } from '../src/pageOrchestrator.js';
import { pdfToPng } from '../src';

const SAMPLE_PDF = resolve('./test-data/sample.pdf');

test('should allow outputFolder paths outside cwd when the filename stays contained', async () => {
    const outputFolder = '../escape';
    const resolvedOutputFolder = resolve(outputFolder);

    try {
        const pages = await pdfToPng(SAMPLE_PDF, {
            outputFolder,
            outputFileMaskFunc: () => 'allowed.png',
            pagesToProcess: [1],
            returnPageContent: false,
        });

        expect(pages).toHaveLength(1);
        expect(pages[0].path).toBe(resolve(resolvedOutputFolder, 'allowed.png'));
    } finally {
        await fsPromises.rm(resolvedOutputFolder, { recursive: true, force: true });
    }
});

test('should reject outputFileMaskFunc values that escape the output folder via parent traversal', async () => {
    const outputFolder = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-security-'));

    try {
        await expect(
            pdfToPng(SAMPLE_PDF, {
                outputFolder,
                outputFileMaskFunc: () => '../escape.png',
                pagesToProcess: [1],
                returnPageContent: false,
            }),
        ).rejects.toThrow('Output file name escapes the output folder');
    } finally {
        await fsPromises.rm(outputFolder, { recursive: true, force: true });
    }
});

test('should reject absolute outputFileMaskFunc values', async () => {
    const outputFolder = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-security-'));

    try {
        await expect(
            pdfToPng(SAMPLE_PDF, {
                outputFolder,
                outputFileMaskFunc: () => '/etc/passwd',
                pagesToProcess: [1],
                returnPageContent: false,
            }),
        ).rejects.toThrow('Output file name escapes the output folder');
    } finally {
        await fsPromises.rm(outputFolder, { recursive: true, force: true });
    }
});

test('should reject empty outputFileMaskFunc filenames', () => {
    expect(() => resolvePageName(1, 'sample', () => '')).toThrow('outputFileMaskFunc returned an empty filename');
});

test('should reject an empty outputFolder before any I/O', async () => {
    await expect(pdfToPng(SAMPLE_PDF, { outputFolder: '' })).rejects.toThrow('outputFolder must not be empty');
});

test('should reject pagesToProcess entries of 0 before any I/O', async () => {
    await expect(pdfToPng(SAMPLE_PDF, { pagesToProcess: [0] })).rejects.toThrow('pagesToProcess contains invalid page number: 0');
});

test('should reject negative pagesToProcess entries before any I/O', async () => {
    await expect(pdfToPng(SAMPLE_PDF, { pagesToProcess: [-1] })).rejects.toThrow('pagesToProcess contains invalid page number: -1');
});

test('should silently ignore pagesToProcess entries above the document page count', async () => {
    await expect(pdfToPng(SAMPLE_PDF, { pagesToProcess: [999999] })).resolves.toEqual([]);
});

test('should reject invalid verbosity levels before reaching pdfjs', async () => {
    const invalidOptions = { verbosityLevel: 3 } as unknown as PdfToPngOptions;

    await expect(pdfToPng(SAMPLE_PDF, invalidOptions)).rejects.toThrow('verbosityLevel must be 0, 1, or 5');
});

test('should fail with EEXIST when the target filename path is a symlink pointing outside outputFolder', async () => {
    const outputFolder = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-symlink-'));
    const symlinkTarget = SAMPLE_PDF;
    const targetFilePath = join(outputFolder, 'sample_page_1.png');

    await fsPromises.symlink(symlinkTarget, targetFilePath);

    try {
        await expect(
            pdfToPng(SAMPLE_PDF, {
                outputFolder,
                pagesToProcess: [1],
                returnPageContent: false,
            }),
        ).rejects.toMatchObject({ code: 'EEXIST' });
    } finally {
        await fsPromises.rm(outputFolder, { recursive: true, force: true });
    }
});
