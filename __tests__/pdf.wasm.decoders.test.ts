import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { checkFixtureDirectory, FIXTURE_DIRECTORY } from '../scripts/generate-wasm-fixtures';
import { pdfToPng } from '../src';
import {
    blankPagePng,
    codecPdf,
    controlPdf,
    countDark,
    decodePng,
    expectCodecPageMatchesControl,
    expectFlatMidGray,
    expectPageShowsPicture,
    FLATE_ONE_BIT_PDF,
    JPX_FLAT_GRAY_PDF,
    PAIRS,
    STANDARD_FONT_TEXT_PDF,
    WASM_FIXTURE_DIR,
} from './wasmFixtures';

/**
 * Regression suite for issue #278: pdfjs-dist 6.x decodes CCITT, JBIG2 and JPEG 2000 images only through wasm files
 * found via the `wasmUrl` document parameter. Without it those images render blank and pdf.js reports nothing.
 *
 * Every codec fixture is compared byte for byte with its Flate control, and the PNG is decoded so two blank
 * renders can never pass. The worker-thread, compiled-CLI and missing-wasm cases need `out/` or a separate
 * process and live in pdf.to.png.worker.threads.test.ts.
 */

describe('harness guards', () => {
    test('the committed fixtures are exactly what scripts/generate-wasm-fixtures.ts produces', () => {
        expect(FIXTURE_DIRECTORY).toBe(WASM_FIXTURE_DIR);
        expect(checkFixtureDirectory(FIXTURE_DIRECTORY)).toEqual([]);
    });

    test('an empty page renders all white, so a missed decode cannot look like a picture', async () => {
        const blank = await decodePng(await blankPagePng(128, 128));

        expect([blank.width, blank.height]).toEqual([128, 128]);
        expect(countDark(blank)).toBe(0);
        expect(blank.data.every((value) => value === 255)).toBe(true);
    });

    test('a Flate 1-bit image renders its black half without any wasm decoder', async () => {
        const [page] = await pdfToPng(FLATE_ONE_BIT_PDF);
        const image = await decodePng(page.content as Buffer);

        expect([image.width, image.height]).toEqual([128, 128]);
        expect(countDark(image)).toBe(8192);
    });
});

describe.each(PAIRS)('wasm decoder fixture $name', (pair) => {
    test('renders byte-identical to its Flate control on the main thread', async () => {
        const [control, codec] = [await pdfToPng(controlPdf(pair.name)), await pdfToPng(codecPdf(pair.name))];

        expect(codec).toHaveLength(pair.pages.length);
        expect(control).toHaveLength(pair.pages.length);
        for (const [index, page] of pair.pages.entries()) {
            expect(codec[index].pageNumber).toBe(index + 1);
            await expectCodecPageMatchesControl(codec[index].content as Buffer, control[index].content as Buffer, page, pair.name);
        }
    });

    test('renders byte-identical to its Flate control with parallel main-thread rendering', async () => {
        const options = { processPagesInParallel: true, concurrencyLimit: 4 };
        const [control, codec] = [await pdfToPng(controlPdf(pair.name), options), await pdfToPng(codecPdf(pair.name), options)];

        expect(codec).toHaveLength(pair.pages.length);
        for (const [index, page] of pair.pages.entries()) {
            expect(codec[index].pageNumber).toBe(index + 1);
            await expectCodecPageMatchesControl(codec[index].content as Buffer, control[index].content as Buffer, page, pair.name);
        }
    });
});

describe('JPEG 2000 image', () => {
    test('decodes through openjpeg.wasm to a flat mid-gray page on the main thread', async () => {
        const [page] = await pdfToPng(JPX_FLAT_GRAY_PDF);

        await expectFlatMidGray(page.content as Buffer);
    });

    test('decodes to a flat mid-gray page with parallel main-thread rendering', async () => {
        const [page] = await pdfToPng(JPX_FLAT_GRAY_PDF, { processPagesInParallel: true, concurrencyLimit: 2 });

        await expectFlatMidGray(page.content as Buffer);
    });
});

describe('working directory independence', () => {
    const originalCwd = process.cwd();
    let emptyDirectory: string | undefined;

    afterEach(() => {
        // Leave the directory before deleting it: Windows refuses to remove the current working directory.
        process.chdir(originalCwd);
        if (emptyDirectory !== undefined) {
            rmSync(emptyDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
            emptyDirectory = undefined;
        }
    });

    // pdf.js keeps wasm bytes in a process-wide cache once one load has succeeded, so this test cannot tell whether
    // the cwd was honoured when an earlier test already loaded the decoder. It asserts only the positive result and
    // therefore passes regardless of order. The compiled CLI test in a fresh process is the strict version.
    test('renders CCITT, JBIG2 and JPEG 2000 images while the working directory is an empty folder', async () => {
        emptyDirectory = mkdtempSync(join(tmpdir(), 'pdf-to-png-cwd-'));
        process.chdir(emptyDirectory);
        expect(readdirSync(process.cwd())).toEqual([]);
        expect(existsSync(join(process.cwd(), 'node_modules'))).toBe(false);

        const pairs = PAIRS.filter((pair) => pair.name === 'ccitt-g4' || pair.name === 'jbig2-mmr' || pair.name === 'jbig2-arith');
        expect(pairs).toHaveLength(3);
        for (const pair of pairs) {
            const [control] = await pdfToPng(controlPdf(pair.name));
            const [codec] = await pdfToPng(codecPdf(pair.name));

            await expectCodecPageMatchesControl(codec.content as Buffer, control.content as Buffer, pair.pages[0], pair.name);
        }
        const [jpx] = await pdfToPng(JPX_FLAT_GRAY_PDF);
        await expectFlatMidGray(jpx.content as Buffer);
    });

    // The standard_fonts folder is read per document, so unlike the wasm bytes it is not cached for the process:
    // rendering the reference first and then again from the empty folder must give the same bytes.
    test('renders a standard-font text page identically while the working directory is an empty folder', async () => {
        const [reference] = await pdfToPng(STANDARD_FONT_TEXT_PDF, { pagesToProcess: [1] });
        emptyDirectory = mkdtempSync(join(tmpdir(), 'pdf-to-png-cwd-'));
        process.chdir(emptyDirectory);

        const [fromEmptyDirectory] = await pdfToPng(STANDARD_FONT_TEXT_PDF, { pagesToProcess: [1] });

        expect(countDark(await decodePng(reference.content as Buffer))).toBeGreaterThan(0);
        expect(Buffer.compare(fromEmptyDirectory.content as Buffer, reference.content as Buffer)).toBe(0);
    });
});

// Keeps the picture check honest: it must reject a page that is not the fixture's picture, not merely accept the right one.
describe('picture check', () => {
    test('rejects a blank page for every fixture', async () => {
        for (const pair of PAIRS) {
            for (const page of pair.pages) {
                await expect(
                    expectPageShowsPicture(await blankPagePng(page.pixelWidth, page.pixelHeight), page, pair.name),
                ).rejects.toThrow();
            }
        }
    });
});
