import { execSync } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { pdfToPng } from '../src/pdfToPng';

/**
 * Integration tests for renderInWorkerThreads mode with REAL worker threads.
 *
 * Workers can only execute compiled JavaScript, so the pool loads `out/pageRenderWorker.js`
 * even when the main-thread code under test runs from `src/` (see resolveWorkerEntryPath in
 * src/workerPool.ts). Build `out/` first so the worker artifact matches the current sources —
 * `tsc` directly, NOT `npm run build`, whose clean step would delete `test-results/` while
 * other vitest workers are writing into it.
 */
beforeAll(() => {
    try {
        execSync('npx tsc --project tsconfig.prod.json', { cwd: resolve(__dirname, '..'), stdio: 'pipe' });
    } catch (error) {
        const output = error as { stdout?: Buffer; stderr?: Buffer };
        throw new Error(`worker entry build (tsc) failed:\n${output.stdout?.toString() ?? ''}\n${output.stderr?.toString() ?? ''}`, {
            cause: error,
        });
    }
}, 120_000);

const samplePdf = resolve('./test-data/sample.pdf');
const largePdf = resolve('./test-data/large_pdf.pdf');
const protectedPdf = resolve('./test-data/large_pdf-protected.pdf');

test('worker mode returns byte-identical page content to main-thread mode', async () => {
    const [mainThread, workers] = [
        await pdfToPng(samplePdf, { pagesToProcess: [1, 2] }),
        await pdfToPng(samplePdf, { pagesToProcess: [1, 2], renderInWorkerThreads: true }),
    ];

    expect(workers).toHaveLength(mainThread.length);
    for (const [index, page] of workers.entries()) {
        expect(page.pageNumber).toBe(mainThread[index].pageNumber);
        expect(page.name).toBe(mainThread[index].name);
        expect(page.width).toBe(mainThread[index].width);
        expect(page.height).toBe(mainThread[index].height);
        expect(page.rotation).toBe(mainThread[index].rotation);
        expect(page.content).toBeInstanceOf(Buffer);
        expect(Buffer.compare(page.content as Buffer, mainThread[index].content as Buffer)).toBe(0);
    }
});

test('worker mode writes byte-identical files through the main-thread sink', async () => {
    const workerFolder = resolve('./test-results/worker-threads-files');
    const mainFolder = resolve('./test-results/worker-threads-files-reference');
    await fsPromises.rm(workerFolder, { recursive: true, force: true });
    await fsPromises.rm(mainFolder, { recursive: true, force: true });

    // Pages 1 and 3 are light pages of the 12-page fixture — fast, still exercises >1 task.
    const workers = await pdfToPng(largePdf, {
        pagesToProcess: [1, 3],
        renderInWorkerThreads: true,
        outputFolder: workerFolder,
        returnPageContent: false,
    });
    const mainThread = await pdfToPng(largePdf, {
        pagesToProcess: [1, 3],
        outputFolder: mainFolder,
        returnPageContent: false,
    });

    expect(workers).toHaveLength(2);
    for (const [index, page] of workers.entries()) {
        expect(page.kind).toBe('file');
        // returnPageContent: false — content trimmed after the write, exactly like main-thread mode.
        expect(page.content).toBeUndefined();
        expect(page.path.startsWith(workerFolder)).toBe(true);
        const workerBytes = await fsPromises.readFile(page.path);
        const mainBytes = await fsPromises.readFile(mainThread[index].path);
        expect(Buffer.compare(workerBytes, mainBytes)).toBe(0);
    }
});

test('worker mode respects outputFileMaskFunc (names resolved on the main thread)', async () => {
    const outputFolder = resolve('./test-results/worker-threads-mask');
    await fsPromises.rm(outputFolder, { recursive: true, force: true });

    const pages = await pdfToPng(samplePdf, {
        renderInWorkerThreads: true,
        outputFolder,
        returnPageContent: false,
        outputFileMaskFunc: (pageNumber: number) => `masked_${pageNumber}.png`,
    });

    expect(pages.map((page) => page.name)).toEqual(['masked_1.png', 'masked_2.png']);
    await expect(fsPromises.access(join(outputFolder, 'masked_2.png'))).resolves.toBeUndefined();
});

test('worker mode silently filters out-of-range page numbers like main-thread mode', async () => {
    // 99 exceeds numPages and is silently dropped; non-positive numbers are rejected by
    // normalization before any mode-specific code runs, so they are not part of this test.
    const pages = await pdfToPng(samplePdf, {
        pagesToProcess: [1, 99],
        renderInWorkerThreads: true,
    });

    expect(pages.map((page) => page.pageNumber)).toEqual([1]);
});

test('a single worker reuses its document across pages and stays byte-identical (pool of 1, 3 pages)', async () => {
    const [mainThread, workers] = [
        await pdfToPng(largePdf, { pagesToProcess: [1, 3, 5] }),
        await pdfToPng(largePdf, { pagesToProcess: [1, 3, 5], renderInWorkerThreads: true, concurrencyLimit: 1 }),
    ];

    expect(workers.map((page) => page.pageNumber)).toEqual([1, 3, 5]);
    for (const [index, page] of workers.entries()) {
        expect(Buffer.compare(page.content as Buffer, mainThread[index].content as Buffer)).toBe(0);
    }
});

test('worker mode passes the password through and renders a protected PDF byte-identically', async () => {
    const password = 'uES69xm545C/HP!';
    const [mainThread, workers] = [
        await pdfToPng(protectedPdf, { pagesToProcess: [1], pdfFilePassword: password }),
        await pdfToPng(protectedPdf, { pagesToProcess: [1], pdfFilePassword: password, renderInWorkerThreads: true }),
    ];

    expect(Buffer.compare(workers[0].content as Buffer, mainThread[0].content as Buffer)).toBe(0);
});

test('worker mode applies viewportScale and stays byte-identical to main-thread mode', async () => {
    const [mainThread, workers] = [
        await pdfToPng(samplePdf, { pagesToProcess: [1], viewportScale: 2 }),
        await pdfToPng(samplePdf, { pagesToProcess: [1], viewportScale: 2, renderInWorkerThreads: true }),
    ];

    expect(workers[0].width).toBe(mainThread[0].width);
    expect(Buffer.compare(workers[0].content as Buffer, mainThread[0].content as Buffer)).toBe(0);
});

test('worker mode rejects with the pdfjs password error when the password is wrong', async () => {
    await expect(
        pdfToPng(protectedPdf, {
            pagesToProcess: [1],
            renderInWorkerThreads: true,
            pdfFilePassword: 'wrong-password',
        }),
    ).rejects.toThrow(/password/i);
});

test('worker mode is ignored for metadata-only conversions', async () => {
    const pages = await pdfToPng(samplePdf, {
        renderInWorkerThreads: true,
        returnMetadataOnly: true,
    });

    expect(pages).toHaveLength(2);
    for (const page of pages) {
        expect(page.kind).toBe('metadata');
        expect(page.content).toBeUndefined();
        expect(page.width).toBeGreaterThan(0);
    }
});
