import { execSync, spawnSync } from 'node:child_process';
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    promises as fsPromises,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { PDF_TO_PNG_OPTIONS_DEFAULTS } from '../src/const';
import * as pageRenderer from '../src/pageRenderer';
import { pdfToPng } from '../src/pdfToPng';
import type { PdfToPngOptions, PngPageOutput } from '../src/types';
import * as workerPool from '../src/workerPool';
import {
    blankPagePng,
    codecPdf,
    controlPdf,
    countDark,
    countNonWhite,
    decodePng,
    expectCodecPageMatchesControl,
    expectFlatMidGray,
    expectPageShowsPicture,
    JPX_FLAT_GRAY_PDF,
    MIXED_PAIR_NAME,
    PAIRS,
    predefinedCMapTextPdf,
    STANDARD_FONT_TEXT_PDF,
} from './wasmFixtures';

/**
 * Integration tests for renderInWorkerThreads mode with REAL worker threads.
 *
 * Workers can only execute compiled JavaScript, so the pool loads `out/pageRenderWorker.js`
 * even when the main-thread code under test runs from `src/` (see resolveWorkerEntryPath in
 * src/workerPool.ts). Build `out/` first so the worker artifact matches the current sources —
 * `tsc` directly, NOT `npm run build`, whose clean step would delete `test-results/` while
 * other vitest workers are writing into it.
 *
 * The same compiled `out/` also serves the issue #278 tests at the end of this file: the real CLI run from an
 * empty working directory, and a child process whose pdfjs-dist has no wasm folder. They share this single
 * compile on purpose. Vitest runs test files in parallel and the tests inside one file one after another, so a
 * second file that rebuilt `out/` could overwrite `pageRenderWorker.js` while a worker thread here is loading it.
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

// Worker and main-thread rendering produce byte-identical PNGs, so comparing output cannot show which of them ran. These spies can:
// pdfToPng() calls renderPagesInWorkerPool for renderInWorkerThreads and renderPdfPage for every page it renders itself. Workers run
// the compiled copy in out/, which a spy here cannot see, so a conversion that really ran in workers never reaches the renderer spy.
let poolSpy: MockInstance<typeof workerPool.renderPagesInWorkerPool>;
let rendererSpy: MockInstance<typeof pageRenderer.renderPdfPage>;

beforeEach(() => {
    poolSpy = vi.spyOn(workerPool, 'renderPagesInWorkerPool');
    rendererSpy = vi.spyOn(pageRenderer, 'renderPdfPage');
});

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Converts with `renderInWorkerThreads: true` and proves the pool did the work: it ran exactly once, with one task per returned
 * page and a size of `concurrencyLimit`, and the main thread rendered none of the pages itself.
 */
async function pdfToPngInWorkers(pdfFile: Parameters<typeof pdfToPng>[0], options: PdfToPngOptions = {}): Promise<PngPageOutput[]> {
    const poolRuns = poolSpy.mock.calls.length;
    const mainThreadRenders = rendererSpy.mock.calls.length;

    const pages = await pdfToPng(pdfFile, { ...options, renderInWorkerThreads: true });

    expect(poolSpy.mock.calls).toHaveLength(poolRuns + 1);
    // renderPagesInWorkerPool(pdfBuffer, renderOptions, materializeContent, tasks, poolSize, onPageRendered)
    const [, , , tasks, poolSize] = poolSpy.mock.calls[poolRuns];
    expect(tasks.map((task) => task.pageNumber)).toEqual(pages.map((page) => page.pageNumber));
    expect(poolSize).toBe(options.concurrencyLimit ?? PDF_TO_PNG_OPTIONS_DEFAULTS.concurrencyLimit);
    expect(rendererSpy.mock.calls).toHaveLength(mainThreadRenders);
    return pages;
}

test('main-thread conversions render on the main thread and never start the worker pool', async () => {
    // Sequential, and then main-thread parallel: neither may reach the pool. The renderer spy seeing both pages is also the proof
    // that it intercepts pdfToPng()'s calls, which is what gives "the main thread rendered nothing" meaning in worker mode.
    expect(await pdfToPng(samplePdf, { pagesToProcess: [1, 2] })).toHaveLength(2);
    expect(rendererSpy).toHaveBeenCalledTimes(2);

    expect(await pdfToPng(samplePdf, { pagesToProcess: [1, 2], processPagesInParallel: true, concurrencyLimit: 2 })).toHaveLength(2);
    expect(rendererSpy).toHaveBeenCalledTimes(4);

    expect(poolSpy).not.toHaveBeenCalled();
});

test('worker mode returns byte-identical page content to main-thread mode', async () => {
    const [mainThread, workers] = [
        await pdfToPng(samplePdf, { pagesToProcess: [1, 2] }),
        await pdfToPngInWorkers(samplePdf, { pagesToProcess: [1, 2] }),
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
    const workers = await pdfToPngInWorkers(largePdf, {
        pagesToProcess: [1, 3],
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

    const pages = await pdfToPngInWorkers(samplePdf, {
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
    const pages = await pdfToPngInWorkers(samplePdf, { pagesToProcess: [1, 99] });

    expect(pages.map((page) => page.pageNumber)).toEqual([1]);
});

test('a single worker reuses its document across pages and stays byte-identical (pool of 1, 3 pages)', async () => {
    const [mainThread, workers] = [
        await pdfToPng(largePdf, { pagesToProcess: [1, 3, 5] }),
        await pdfToPngInWorkers(largePdf, { pagesToProcess: [1, 3, 5], concurrencyLimit: 1 }),
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
        await pdfToPngInWorkers(protectedPdf, { pagesToProcess: [1], pdfFilePassword: password }),
    ];

    expect(Buffer.compare(workers[0].content as Buffer, mainThread[0].content as Buffer)).toBe(0);
});

test('worker mode applies viewportScale and stays byte-identical to main-thread mode', async () => {
    const [mainThread, workers] = [
        await pdfToPng(samplePdf, { pagesToProcess: [1], viewportScale: 2 }),
        await pdfToPngInWorkers(samplePdf, { pagesToProcess: [1], viewportScale: 2 }),
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
    // The main thread opens the document first and fails there, so no worker was ever started.
    expect(poolSpy).not.toHaveBeenCalled();
});

test('worker mode is ignored for metadata-only conversions', async () => {
    const pages = await pdfToPng(samplePdf, {
        renderInWorkerThreads: true,
        returnMetadataOnly: true,
    });

    // Metadata-only never renders: no worker pool, and no main-thread page render either.
    expect(poolSpy).not.toHaveBeenCalled();
    expect(rendererSpy).not.toHaveBeenCalled();
    expect(pages).toHaveLength(2);
    for (const page of pages) {
        expect(page.kind).toBe('metadata');
        expect(page.content).toBeUndefined();
        expect(page.width).toBeGreaterThan(0);
    }
});

test('worker mode takes precedence over processPagesInParallel', async () => {
    // The helper's checks are the assertion: the pool ran once with a size of 2, and the main thread rendered nothing.
    const pages = await pdfToPngInWorkers(largePdf, { pagesToProcess: [1, 3], processPagesInParallel: true, concurrencyLimit: 2 });

    expect(pages.map((page) => page.pageNumber)).toEqual([1, 3]);
});

/**
 * A two-page PDF that opens normally but whose page tree lists a second kid, object 99, that does not exist. The main thread loads
 * the document and sees two pages; fetching page 2 then throws a pdf.js exception (UnknownErrorException). Like every pdf.js exception
 * it is `instanceof Error` without being a native error, so the structured clone behind `postMessage` turns it into a plain object.
 */
function pdfWithMissingPageKid(): Uint8Array {
    const header = '%PDF-1.7\n';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 99 0 R] /Count 2 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
    ].map((body, index) => `${index + 1} 0 obj\n${body}\nendobj\n`);
    const offsets = objects.map((_, index) => header.length + objects.slice(0, index).join('').length);
    const xref =
        `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${header.length + objects.join('').length}\n%%EOF\n`;
    return Buffer.from(header + objects.join('') + xref + trailer, 'latin1');
}

/** What a conversion rejects with, whatever that is. */
async function rejectionOf(conversion: Promise<unknown>): Promise<unknown> {
    return conversion.then(
        () => {
            throw new Error('the conversion was expected to reject');
        },
        (reason: unknown) => reason,
    );
}

test('worker mode rejects with a real Error carrying the pdf.js message and name, like main-thread mode', async () => {
    const pdf = pdfWithMissingPageKid();
    const mainThreadError = await rejectionOf(pdfToPng(pdf, { pagesToProcess: [2] }));
    expect(mainThreadError).toBeInstanceOf(Error);
    // Premise: pdf.js picked this name, so only the name sent separately and restored by the pool can make the two modes agree.
    expect((mainThreadError as Error).name).not.toBe('Error');

    const workerError = await rejectionOf(pdfToPng(pdf, { pagesToProcess: [2], renderInWorkerThreads: true }));

    // The failure really crossed the thread boundary: the pool ran for it.
    expect(poolSpy).toHaveBeenCalledOnce();
    expect(workerError).toBeInstanceOf(Error);
    expect(workerError).toMatchObject({ name: (mainThreadError as Error).name, message: (mainThreadError as Error).message });
    expect(String(workerError)).not.toContain('[object Object]');
});

// ---------------------------------------------------------------------------------------------------------------------
// Issue #278: CCITT, JBIG2 and JPEG 2000 images need the pdf.js wasm decoders (see __tests__/wasmFixtures.ts).
// ---------------------------------------------------------------------------------------------------------------------

describe.each(PAIRS)('wasm decoder fixture $name in worker threads', (pair) => {
    test('renders byte-identical to its Flate control rendered on the main thread', async () => {
        const control = await pdfToPng(controlPdf(pair.name));
        const codec = await pdfToPngInWorkers(codecPdf(pair.name), { concurrencyLimit: 4 });

        expect(codec).toHaveLength(pair.pages.length);
        for (const [index, page] of pair.pages.entries()) {
            expect(codec[index].pageNumber).toBe(index + 1);
            await expectCodecPageMatchesControl(codec[index].content as Buffer, control[index].content as Buffer, page, pair.name);
        }
    });
});

test('one worker decodes every codec page of a mixed document and reuses its decoders (pool of 1, 8 pages)', async () => {
    const pair = PAIRS.find((candidate) => candidate.name === MIXED_PAIR_NAME);
    expect(pair?.pages).toHaveLength(8);

    const control = await pdfToPng(controlPdf(MIXED_PAIR_NAME));
    const codec = await pdfToPngInWorkers(codecPdf(MIXED_PAIR_NAME), { concurrencyLimit: 1 });

    expect(codec.map((page) => page.pageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const [index, page] of (pair?.pages ?? []).entries()) {
        await expectCodecPageMatchesControl(codec[index].content as Buffer, control[index].content as Buffer, page, MIXED_PAIR_NAME);
    }
});

test('worker threads decode a JPEG 2000 image through openjpeg.wasm', async () => {
    const [page] = await pdfToPngInWorkers(JPX_FLAT_GRAY_PDF);

    await expectFlatMidGray(page.content as Buffer);
});

/** A child's environment without anything that could change warning output or write coverage files. */
function childEnvironment(): typeof process.env {
    const environment = { ...process.env };
    for (const name of ['NODE_OPTIONS', 'NODE_V8_COVERAGE', 'NODE_NO_WARNINGS']) {
        delete environment[name];
    }
    return environment;
}

describe('compiled library from a fresh process', () => {
    const repositoryRoot = resolve(__dirname, '..');
    const compiledDirectory = join(repositoryRoot, 'out');
    const temporaryDirectories: string[] = [];

    function makeTemporaryDirectory(): string {
        const directory = mkdtempSync(join(tmpdir(), 'pdf-to-png-wasm-'));
        temporaryDirectories.push(directory);
        return directory;
    }

    afterEach(() => {
        // Plain directories and copies only (no junctions), so a recursive delete cannot reach node_modules.
        for (const directory of temporaryDirectories.splice(0)) {
            rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    });

    /** Runs the compiled CLI on one PDF in `workingDirectory` and returns the output folder. */
    function runCli(workingDirectory: string, pdfPath: string, extraArguments: string[] = []): string {
        const outputFolder = join(makeTemporaryDirectory(), 'png');

        const result = spawnSync(
            process.execPath,
            [join(compiledDirectory, 'cli.js'), pdfPath, '--output-folder', outputFolder, '--silent', ...extraArguments],
            { cwd: workingDirectory, env: childEnvironment(), encoding: 'utf8', timeout: 120_000 },
        );

        expect(result.status, result.stderr).toBe(0);
        // Present decoders mean no process warning.
        expect(result.stderr).not.toContain('PDF_TO_PNG_WASM_MISSING');
        return outputFolder;
    }

    /** Runs the compiled CLI on one PDF with an empty temporary folder as its working directory. */
    function runCliFromEmptyDirectory(pdfPath: string, extraArguments: string[] = []): { emptyDirectory: string; outputFolder: string } {
        const emptyDirectory = makeTemporaryDirectory();
        expect(readdirSync(emptyDirectory)).toEqual([]);
        return { emptyDirectory, outputFolder: runCli(emptyDirectory, pdfPath, extraArguments) };
    }

    // Strict proof of working-directory independence for the wasm decoders: a new process has an empty pdf.js
    // wasm cache, and its working directory has no node_modules, so only the package-relative lookup can work.
    test.each([
        ['ccitt-g4', 'CCITT Group 4'],
        ['jbig2-mmr', 'JBIG2'],
    ])(
        'the compiled CLI renders %s (%s) from an empty working directory',
        async (name) => {
            const pair = PAIRS.find((candidate) => candidate.name === name);
            expect(pair).toBeDefined();

            const { emptyDirectory, outputFolder } = runCliFromEmptyDirectory(codecPdf(name));

            const files = readdirSync(outputFolder);
            expect(files).toHaveLength(1);
            const written = readFileSync(join(outputFolder, files[0]));
            const [control] = await pdfToPng(controlPdf(name));
            await expectCodecPageMatchesControl(written, control.content as Buffer, (pair?.pages ?? [])[0], name);
            // The child must not have created anything in its working directory either.
            expect(readdirSync(emptyDirectory)).toEqual([]);
        },
        180_000,
    );

    test('the compiled CLI renders the JPEG 2000 image from an empty working directory', async () => {
        const { emptyDirectory, outputFolder } = runCliFromEmptyDirectory(JPX_FLAT_GRAY_PDF);

        const files = readdirSync(outputFolder);
        expect(files).toHaveLength(1);
        await expectFlatMidGray(readFileSync(join(outputFolder, files[0])));
        expect(readdirSync(emptyDirectory)).toEqual([]);
    }, 180_000);

    // The working directory must be ignored, not merely unnecessary. A lookup that tried `<cwd>/node_modules` first
    // would read this garbage jbig2.wasm, fail to instantiate it, and import the decoy JS fallback, which writes the marker.
    test('the compiled CLI ignores a decoy pdfjs-dist in its working directory', async () => {
        const workingDirectory = makeTemporaryDirectory();
        const marker = join(makeTemporaryDirectory(), 'decoy-fallback-ran');
        const decoyRoot = join(workingDirectory, 'node_modules', 'pdfjs-dist');
        for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
            mkdirSync(join(decoyRoot, folder), { recursive: true });
        }
        writeFileSync(join(decoyRoot, 'package.json'), JSON.stringify({ name: 'pdfjs-dist', version: '0.0.0-decoy' }));
        // Both decoder files exist, so the missing-file warning stays quiet and only the render and marker can fail.
        for (const file of ['jbig2.wasm', 'openjpeg.wasm']) {
            writeFileSync(join(decoyRoot, 'wasm', file), 'not a wasm module');
        }
        // `process.getBuiltinModule` works whether Node loads the file as CommonJS or as an ES module.
        writeFileSync(
            join(decoyRoot, 'wasm', 'jbig2_nowasm_fallback.js'),
            `process.getBuiltinModule('node:fs').writeFileSync(${JSON.stringify(marker)}, 'decoy loaded');\n`,
        );
        const pair = PAIRS.find((candidate) => candidate.name === 'jbig2-mmr');
        expect(pair).toBeDefined();

        const outputFolder = runCli(workingDirectory, codecPdf('jbig2-mmr'));

        const files = readdirSync(outputFolder);
        expect(files).toHaveLength(1);
        const [control] = await pdfToPng(controlPdf('jbig2-mmr'));
        await expectCodecPageMatchesControl(
            readFileSync(join(outputFolder, files[0])),
            control.content as Buffer,
            (pair?.pages ?? [])[0],
            'jbig2-mmr',
        );
        expect(existsSync(marker)).toBe(false);
    }, 180_000);

    // Fresh process + worker threads + empty working directory together: every worker resolves the package root itself,
    // and the 8 mixed G4/G3/JBIG2 pages must match the Flate control page for page.
    test('the compiled CLI renders the mixed CCITT/JBIG2 pages in worker threads from an empty working directory', async () => {
        const pair = PAIRS.find((candidate) => candidate.name === 'mixed-pages');
        expect(pair).toBeDefined();
        const pages = pair?.pages ?? [];
        expect(pages.length).toBeGreaterThanOrEqual(6);

        const { emptyDirectory, outputFolder } = runCliFromEmptyDirectory(codecPdf('mixed-pages'), [
            '--render-in-worker-threads',
            '--concurrency-limit',
            '3',
        ]);

        const control = await pdfToPng(controlPdf('mixed-pages'));
        expect(readdirSync(outputFolder)).toHaveLength(pages.length);
        for (const [index, page] of pages.entries()) {
            const written = readFileSync(join(outputFolder, `mixed-pages_page_${index + 1}.png`));
            await expectCodecPageMatchesControl(written, control[index].content as Buffer, page, `mixed-pages page ${index + 1}`);
        }
        expect(readdirSync(emptyDirectory)).toEqual([]);
    }, 180_000);

    // A page that fails inside a worker used to reach the CLI as a plain object, which it printed as "[object Object]".
    test('the compiled CLI prints the pdf.js message when a page fails in worker threads', async () => {
        const pdfPath = join(makeTemporaryDirectory(), 'missing-kid.pdf');
        writeFileSync(pdfPath, pdfWithMissingPageKid());
        const expectedMessage = ((await rejectionOf(pdfToPng(pdfPath, { pagesToProcess: [2] }))) as Error).message;

        const result = spawnSync(
            process.execPath,
            [
                join(compiledDirectory, 'cli.js'),
                pdfPath,
                '--output-folder',
                join(makeTemporaryDirectory(), 'png'),
                '--silent',
                '--pages-to-process',
                '2',
                '--render-in-worker-threads',
            ],
            { env: childEnvironment(), encoding: 'utf8', timeout: 120_000 },
        );

        expect(result.status, result.stderr).toBe(1);
        expect(result.stderr).toContain(expectedMessage);
        expect(result.stderr).not.toContain('[object Object]');
    }, 180_000);

    test('the compiled CLI finds the standard fonts from an empty working directory', async () => {
        const { outputFolder } = runCliFromEmptyDirectory(STANDARD_FONT_TEXT_PDF, ['--pages-to-process', '1']);

        const files = readdirSync(outputFolder);
        expect(files).toHaveLength(1);
        const [reference] = await pdfToPng(STANDARD_FONT_TEXT_PDF, { pagesToProcess: [1] });
        expect(Buffer.compare(readFileSync(join(outputFolder, files[0])), reference.content as Buffer)).toBe(0);
    }, 180_000);

    // test-data/sample.pdf loads no CMap. This generated page draws its text through the predefined UniJIS-UCS2-H CMap,
    // and pdf.js draws nothing for that font when the bcmap fetch fails, so a blank page means cmaps was not found.
    test('the compiled CLI finds the predefined CMaps from an empty working directory', async () => {
        const pdfPath = join(makeTemporaryDirectory(), 'predefined-cmap.pdf');
        writeFileSync(pdfPath, predefinedCMapTextPdf());

        const { outputFolder } = runCliFromEmptyDirectory(pdfPath);

        const files = readdirSync(outputFolder);
        expect(files).toHaveLength(1);
        const written = readFileSync(join(outputFolder, files[0]));
        expect(countDark(await decodePng(written)), 'the CMap text was not drawn').toBeGreaterThan(0);
        const [reference] = await pdfToPng(predefinedCMapTextPdf());
        expect(Buffer.compare(written, reference.content as Buffer)).toBe(0);
    }, 180_000);

    test('without the wasm folder a CCITT page renders blank and exactly one process warning is emitted', async () => {
        const root = makeTemporaryDirectory();
        const realPdfjsRoot = dirname(createRequire(__filename).resolve('pdfjs-dist/package.json'));
        const fakeRoot = join(root, 'pdfjs-dist-without-wasm');
        const resultDirectory = join(root, 'result');
        mkdirSync(fakeRoot);
        mkdirSync(resultDirectory);
        writeFileSync(join(fakeRoot, 'package.json'), JSON.stringify({ name: 'pdfjs-dist', version: '0.0.0-fake' }));
        for (const folder of ['cmaps', 'standard_fonts']) {
            cpSync(join(realPdfjsRoot, folder), join(fakeRoot, folder), { recursive: true });
        }
        expect(existsSync(join(fakeRoot, 'wasm'))).toBe(false);

        const result = spawnSync(
            process.execPath,
            [
                join(__dirname, 'wasmMissingChild.cjs'),
                compiledDirectory,
                fakeRoot,
                resultDirectory,
                codecPdf('ccitt-g4'),
                controlPdf('ccitt-g4'),
            ],
            { cwd: root, env: childEnvironment(), encoding: 'utf8', timeout: 150_000 },
        );

        expect(result.status, result.stderr).toBe(0);
        // The wrapper took effect: the compiled loader looked for wasm in the fake root, which has none.
        const report = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') as {
            wasmDirectory: string;
            warnings: { name: string; code: string; message: string }[];
        };
        expect(report.wasmDirectory.replaceAll('\\', '/')).toBe(join(fakeRoot, 'wasm').replaceAll('\\', '/'));

        // Missing decoders leave the page blank and silent below verbosity 1, but the library warns once on the main thread.
        // Count only this library's warning: an unrelated Node or dependency warning in the child must not fail the test.
        expect(result.stderr.match(/\[PDF_TO_PNG_WASM_MISSING\]/g)).toHaveLength(1);
        const wasmWarnings = report.warnings.filter((warning) => warning.code === 'PDF_TO_PNG_WASM_MISSING');
        expect(wasmWarnings).toHaveLength(1);
        expect(wasmWarnings[0].message).toContain('jbig2.wasm, openjpeg.wasm');

        const pair = PAIRS.find((candidate) => candidate.name === 'ccitt-g4');
        const page = (pair?.pages ?? [])[0];
        const codecPng = readFileSync(join(resultDirectory, 'codec.png'));
        const codecAgainPng = readFileSync(join(resultDirectory, 'codec-again.png'));
        const controlPng = readFileSync(join(resultDirectory, 'control.png'));
        // The Flate control never needs wasm, so the same process still draws the picture.
        await expectPageShowsPicture(controlPng, page, 'ccitt-g4');
        for (const png of [codecPng, codecAgainPng]) {
            expect(countNonWhite(await decodePng(png))).toBe(0);
            expect(Buffer.compare(png, await blankPagePng(page.pixelWidth, page.pixelHeight))).toBe(0);
            expect(Buffer.compare(png, controlPng)).not.toBe(0);
        }
    }, 180_000);
});

// An ESM bundle that inlines this library shims `require` (as `createRequire(import.meta.url)`) but leaves
// `__filename` and `__dirname` undefined. The compiled loader is evaluated the same way here, so any unguarded
// `__filename` read throws a ReferenceError.
describe('compiled loader without __filename, as in an ESM bundle', () => {
    const loaderPath = resolve(__dirname, '..', 'out', 'pdfjsLoader.js');
    type LoaderRequire = ReturnType<typeof createRequire>;

    function loadWithoutFilename(loaderRequire: LoaderRequire): typeof import('../src/pdfjsLoader.js') {
        expect(runInThisContext('typeof __filename')).toBe('undefined');
        const loaderModule = { exports: {} };
        const wrapper = runInThisContext(`(function (exports, require, module) {\n${readFileSync(loaderPath, 'utf8')}\n})`, {
            filename: loaderPath,
        }) as (exports: object, require: LoaderRequire, module: object) => void;
        wrapper(loaderModule.exports, loaderRequire, loaderModule);
        return loaderModule.exports as typeof import('../src/pdfjsLoader.js');
    }

    test('finds the installed pdfjs-dist package', () => {
        const { pdfjsAssetDirectory } = loadWithoutFilename(createRequire(loaderPath));

        const pdfjsRoot = dirname(createRequire(__filename).resolve('pdfjs-dist/package.json'));
        expect(pdfjsAssetDirectory('wasm')).toBe(join(pdfjsRoot, 'wasm'));
    });

    test('reports an unresolvable pdfjs-dist with the descriptive error, not a ReferenceError', () => {
        const realRequire = createRequire(loaderPath);
        const notFound = new Error("Cannot find module 'pdfjs-dist/package.json'");
        const failingRequire = Object.assign((id: string): unknown => realRequire(id), {
            resolve: (): never => {
                throw notFound;
            },
        });
        const { pdfjsAssetDirectory } = loadWithoutFilename(failingRequire as unknown as LoaderRequire);

        let thrown: unknown;
        try {
            pdfjsAssetDirectory('wasm');
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toMatchObject({ message: expect.stringContaining('from "pdf-to-png-converter"'), cause: notFound });
    });
});
