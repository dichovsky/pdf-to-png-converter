import { promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { pdfToPng } from '../src';
import { assertValidOutputFilename, savePNGfile } from '../src/outputWriter';

// One path segment holds at most 255 units. APFS, HFS+ and NTFS count UTF-16 code units; most other hosts
// (ext4, xfs, btrfs) count UTF-8 bytes. The preflight picks the unit from the host family, so every
// assertion that depends on it pins the platform instead of trusting the machine running the suite.

const SAMPLE_PDF = resolve('./test-data/sample.pdf');
const TEN_PAGE_PDF = resolve('./test-data/10-page-sample.pdf');
const isWindows = sep === '\\';

afterEach(() => {
    vi.restoreAllMocks();
});

function pinPlatform(platform: typeof process.platform): void {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
}

const utf16Accepted: Array<[string, string]> = [
    ['255 ASCII characters', 'a'.repeat(255)],
    ['255 CJK characters (765 UTF-8 bytes)', '漢'.repeat(255)],
    ['127 emoji and one letter (255 code units, 509 UTF-8 bytes)', '😀'.repeat(127) + 'a'],
];

const utf16Rejected: Array<[string, string]> = [
    ['256 ASCII characters', 'a'.repeat(256)],
    ['256 CJK characters', '漢'.repeat(256)],
    ['128 emoji (256 code units)', '😀'.repeat(128)],
];

test.each(utf16Accepted)('darwin counts UTF-16 code units, so it accepts %s', (_label, name) => {
    pinPlatform('darwin');

    expect(() => assertValidOutputFilename(name)).not.toThrow();
});

test.each(utf16Rejected)('darwin counts UTF-16 code units, so it rejects %s', (_label, name) => {
    pinPlatform('darwin');

    expect(() => assertValidOutputFilename(name)).toThrow('Output file name must be at most 255 UTF-16 code units, received 256.');
});

test.skipIf(isWindows).each([
    ['255 ASCII characters', 'a'.repeat(255)],
    ['127 accented letters and one letter (255 UTF-8 bytes, 128 code units)', 'é'.repeat(127) + 'a'],
    ['85 CJK characters (255 UTF-8 bytes)', '漢'.repeat(85)],
    ['63 emoji and three letters (255 UTF-8 bytes)', '😀'.repeat(63) + 'abc'],
])('linux counts UTF-8 bytes, so it accepts %s', (_label, name) => {
    pinPlatform('linux');

    expect(() => assertValidOutputFilename(name)).not.toThrow();
});

test.skipIf(isWindows).each([
    ['256 ASCII characters', 'a'.repeat(256), 256],
    ['128 accented letters (128 code units, 256 UTF-8 bytes)', 'é'.repeat(128), 256],
    ['86 CJK characters (258 UTF-8 bytes)', '漢'.repeat(86), 258],
    ['64 emoji (256 UTF-8 bytes)', '😀'.repeat(64), 256],
])('linux counts UTF-8 bytes, so it rejects %s', (_label, name, received) => {
    pinPlatform('linux');

    expect(() => assertValidOutputFilename(name)).toThrow(`Output file name must be at most 255 UTF-8 bytes, received ${received}.`);
});

test('the length error reports counts instead of echoing the over-long name', () => {
    pinPlatform('darwin');

    // Anchored, so any echoed part of the 420-character name would fail the match.
    expect(() => assertValidOutputFilename('secret-'.repeat(60))).toThrow(
        /^Output file name must be at most 255 UTF-16 code units, received 420\.$/,
    );
});

test('savePNGfile repeats the length check before any filesystem operation', async () => {
    // No such folder exists, so reaching realpath/open would change this into an ENOENT failure.
    const folder = { resolvedOutputFolder: '/definitely-not-a-real-pdf-to-png-test-folder', realOutputFolder: '/not-used' };

    await expect(savePNGfile('a'.repeat(256), Buffer.alloc(0), folder)).rejects.toThrow('Output file name must be at most 255');
});

const HOST_LENGTH_ERROR = /Output file name must be at most 255 (UTF-16 code units|UTF-8 bytes), received 2\d\d\./;

test('rejects an over-long outputFileMaskFunc name before creating the output folder', async () => {
    const baseDir = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-name-length-'));
    const outputFolder = join(baseDir, 'must-not-be-created');

    try {
        const conversion = pdfToPng(SAMPLE_PDF, {
            outputFolder,
            outputFileMaskFunc: () => `${'a'.repeat(252)}.png`,
            pagesToProcess: [1],
            returnPageContent: false,
        });

        await expect(conversion).rejects.toThrow(HOST_LENGTH_ERROR);
        await expect(conversion).rejects.toSatisfy((error: Error) => !error.message.includes(baseDir));
        await expect(fsPromises.stat(outputFolder)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
        await fsPromises.rm(baseDir, { recursive: true, force: true });
    }
});

// A 251-character PDF stem fits the file system, but its default "<stem>_page_1.png" output name does not.
// Skipped on Windows, where the surrounding temp path would already exceed MAX_PATH.
test.skipIf(isWindows)('rejects an over-long default name derived from the PDF file name before creating the output folder', async () => {
    const baseDir = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-name-length-'));
    const longNamedPdf = join(baseDir, `${'a'.repeat(251)}.pdf`);
    const outputFolder = join(baseDir, 'must-not-be-created');

    try {
        await fsPromises.copyFile(SAMPLE_PDF, longNamedPdf);
        const conversion = pdfToPng(longNamedPdf, { outputFolder, pagesToProcess: [1], returnPageContent: false });

        await expect(conversion).rejects.toThrow(HOST_LENGTH_ERROR);
        await expect(conversion).rejects.toSatisfy((error: Error) => !error.message.includes(baseDir));
        await expect(fsPromises.stat(outputFolder)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
        await fsPromises.rm(baseDir, { recursive: true, force: true });
    }
});

// A 244-character stem gives pages 1-9 names of 255 characters and page 10 a name of 256. The whole plan has to be
// rejected before the first page is written, not after nine files already sit in the output folder.
test.skipIf(isWindows)('rejects the whole plan when only a later page name is too long, before writing any page', async () => {
    const baseDir = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-name-length-'));
    const longNamedPdf = join(baseDir, `${'a'.repeat(244)}.pdf`);
    const outputFolder = join(baseDir, 'must-not-be-created');

    try {
        await fsPromises.copyFile(TEN_PAGE_PDF, longNamedPdf);

        await expect(pdfToPng(longNamedPdf, { outputFolder, returnPageContent: false })).rejects.toThrow(/received 256\./);
        await expect(fsPromises.stat(outputFolder)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
        await fsPromises.rm(baseDir, { recursive: true, force: true });
    }
});

test.skipIf(isWindows)('writes a name of exactly 255 characters', async () => {
    const baseDir = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-name-length-'));
    const name = `${'a'.repeat(251)}.png`;

    try {
        const [page] = await pdfToPng(SAMPLE_PDF, {
            outputFolder: baseDir,
            outputFileMaskFunc: () => name,
            pagesToProcess: [1],
            returnPageContent: false,
        });

        expect(page.name).toBe(name);
        expect((await fsPromises.stat(join(baseDir, name))).size).toBeGreaterThan(0);
    } finally {
        await fsPromises.rm(baseDir, { recursive: true, force: true });
    }
});

test('does not apply the disk length limit to metadata-only requests', async () => {
    const baseDir = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-name-length-'));
    const outputFolder = join(baseDir, 'must-not-be-created');
    const name = `${'a'.repeat(300)}.png`;

    try {
        const [page] = await pdfToPng(SAMPLE_PDF, {
            outputFolder,
            outputFileMaskFunc: () => name,
            pagesToProcess: [1],
            returnMetadataOnly: true,
        });

        expect(page.name).toBe(name);
        await expect(fsPromises.stat(outputFolder)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
        await fsPromises.rm(baseDir, { recursive: true, force: true });
    }
});
