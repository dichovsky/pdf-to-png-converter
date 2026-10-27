import { promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { pdfToPng } from '../src';

const SAMPLE_PDF = resolve('./test-data/sample.pdf');
const originalCwd = process.cwd();

afterEach(() => {
    process.chdir(originalCwd);
});

// The duplicate-name pre-flight exists so a conversion that fails validation writes nothing. The
// existing duplicate-filename suite pre-creates outputFolder to prove no FILES are written, which
// means it would still pass if folder creation were ever hoisted above the check. This asserts the
// other half: the folder itself must not come into existence.
test('a duplicate-filename rejection does not create the output folder', async () => {
    const baseDir = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-invariant-'));
    const outputFolder = join(baseDir, 'never-created');

    try {
        await expect(
            pdfToPng(SAMPLE_PDF, {
                outputFolder,
                outputFileMaskFunc: () => 'same.png',
            }),
        ).rejects.toThrow(/Duplicate output filename/);

        await expect(fsPromises.stat(outputFolder)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
        await fsPromises.rm(baseDir, { recursive: true, force: true });
    }
});

// A relative outputFolder must be anchored to the cwd as it was at conversion start. Resolving it
// lazily — after the per-page name callbacks have run — lets an outputFileMaskFunc that calls
// process.chdir() silently redirect every written file to a different directory.
test('a relative outputFolder is anchored to the cwd at conversion start, not after the mask callback runs', async () => {
    const baseDir = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-invariant-'));
    const elsewhere = join(baseDir, 'elsewhere');
    const relativeOutputFolder = join('test-results', 'cwd-capture-probe');
    const expectedFolder = resolve(originalCwd, relativeOutputFolder);

    await fsPromises.mkdir(elsewhere, { recursive: true });
    await fsPromises.rm(expectedFolder, { recursive: true, force: true });

    try {
        const pages = await pdfToPng(SAMPLE_PDF, {
            outputFolder: relativeOutputFolder,
            pagesToProcess: [1],
            returnPageContent: false,
            outputFileMaskFunc: (pageNumber: number) => {
                process.chdir(elsewhere);
                return `page_${pageNumber}.png`;
            },
        });

        expect(pages).toHaveLength(1);
        expect(pages[0].path).toBe(join(expectedFolder, 'page_1.png'));
        // The redirected location must stay empty.
        expect(await fsPromises.readdir(join(elsewhere, 'test-results')).catch(() => [])).toHaveLength(0);
    } finally {
        process.chdir(originalCwd);
        await fsPromises.rm(baseDir, { recursive: true, force: true });
        await fsPromises.rm(expectedFolder, { recursive: true, force: true });
    }
});

// The folder is resolved before the call's first await, not after the input read, the wasm warm-up and the document
// load. A process.chdir() made while the call is pending (by the caller, or by another conversion's outputFileMaskFunc)
// therefore cannot move the output.
test('a relative outputFolder is anchored at the call, so a later process.chdir() cannot redirect it', async () => {
    const baseDir = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-invariant-'));
    const callerDir = join(baseDir, 'caller');
    const elsewhere = join(baseDir, 'elsewhere');
    await fsPromises.mkdir(callerDir);
    await fsPromises.mkdir(elsewhere);

    try {
        process.chdir(callerDir);
        const callerCwd = process.cwd();
        const conversion = pdfToPng(SAMPLE_PDF, { outputFolder: 'out', pagesToProcess: [1], returnPageContent: false });
        process.chdir(elsewhere);
        const pages = await conversion;

        expect(pages).toHaveLength(1);
        expect(pages[0].path).toBe(join(callerCwd, 'out', 'sample_page_1.png'));
        await expect(fsPromises.access(pages[0].path)).resolves.toBeUndefined();
        expect(await fsPromises.readdir(elsewhere)).toEqual([]);
    } finally {
        process.chdir(originalCwd);
        await fsPromises.rm(baseDir, { recursive: true, force: true });
    }
});
