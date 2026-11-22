import { randomUUID } from 'node:crypto';
import { promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse, resolve, sep } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { MAX_INPUT_BYTES } from '../src/const';
import { getPdfFileBuffer } from '../src/pdfInput';
import { pdfToPng } from '../src/pdfToPng';

// A string input is a file path. A PDF passed as a string by mistake (base64, or document text) used
// to be handed to open(), whose ENAMETOOLONG / ENOENT error copies the whole value into the message
// and into err.path: megabytes of document content in a log line. A string no path can be is now
// rejected before any filesystem call, without being echoed.

const MAX_PATH_CHARS = 4096;

afterEach(() => {
    vi.restoreAllMocks();
});

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
    const rejection: unknown = await promise.catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(Error);
    return rejection as Error;
}

test('rejects a document-sized string without echoing it or touching the filesystem', async () => {
    const open = vi.spyOn(fsPromises, 'open');
    const document = 'JVBERi0xLjQKJcfsj6IK'.repeat(150_000);

    const error = await rejectionOf(getPdfFileBuffer(document, MAX_INPUT_BYTES));

    expect(error.message).toMatch(/Input PDF path is too long/);
    expect(error.message).toMatch(/Buffer or Uint8Array/);
    expect(error.message).not.toContain(document.slice(0, 64));
    expect(error.message.length).toBeLessThan(200);
    expect(open).not.toHaveBeenCalled();
});

test('rejects a string one character over the limit', async () => {
    const open = vi.spyOn(fsPromises, 'open');

    const error = await rejectionOf(getPdfFileBuffer('a'.repeat(MAX_PATH_CHARS + 1), MAX_INPUT_BYTES));

    expect(error.message).toMatch(/Input PDF path is too long/);
    expect(open).not.toHaveBeenCalled();
});

test('still treats a string of exactly the limit as a path and passes the filesystem error through unchanged', async () => {
    const path = parse(tmpdir()).root.padEnd(MAX_PATH_CHARS, 'a');
    const failure = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    const open = vi.spyOn(fsPromises, 'open').mockRejectedValueOnce(failure);

    await expect(getPdfFileBuffer(path, MAX_INPUT_BYTES)).rejects.toBe(failure);
    expect(open).toHaveBeenCalledWith(path, expect.any(Number));
});

test('an ordinary missing path keeps its filesystem error and still names the path', async () => {
    const missing = join(tmpdir(), `pdf-to-png-missing-${randomUUID()}.pdf`);

    const error = await rejectionOf(getPdfFileBuffer(missing, MAX_INPUT_BYTES));

    expect(error).toMatchObject({ code: 'ENOENT' });
    expect(error.message).toContain(missing);
});

test('pdfToPng rejects an over-long string with the same short message', async () => {
    const error = await rejectionOf(pdfToPng('x'.repeat(MAX_PATH_CHARS * 2)));

    expect(error.message).toMatch(/Input PDF path is too long/);
    expect(error.message.length).toBeLessThan(200);
});

test('opens the PDF relative to the working directory at the time of the call', async () => {
    const original = process.cwd();
    const folder = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-input-cwd-'));
    const other = join(folder, 'other');
    const open = fsPromises.open;
    try {
        await fsPromises.mkdir(other);
        await fsPromises.copyFile(join(original, 'test-data', 'sample.pdf'), join(folder, 'report.pdf'));
        await fsPromises.copyFile(join(original, 'test-data', '10-page-sample.pdf'), join(other, 'report.pdf'));
        // Let the caller change directories before the filesystem consumes the submitted path.
        vi.spyOn(fsPromises, 'open').mockImplementation(async (...args) => {
            await Promise.resolve();
            return open(...args);
        });
        process.chdir(folder);
        const conversion = pdfToPng('report.pdf', { returnMetadataOnly: true });
        process.chdir(other);
        const pages = await conversion;
        expect(pages.map((page) => page.name)).toEqual(['report_page_1.png', 'report_page_2.png']);
    } finally {
        process.chdir(original);
        await fsPromises.rm(folder, { recursive: true, force: true });
    }
});

test('preserves empty input and trailing separators for the filesystem', async () => {
    await expect(getPdfFileBuffer('', MAX_INPUT_BYTES)).rejects.toMatchObject({ code: 'ENOENT' });
    const open = vi.spyOn(fsPromises, 'open').mockRejectedValueOnce(new Error('open probe'));
    const input = `test-data${sep}sample.pdf${sep}`;
    await expect(getPdfFileBuffer(input, MAX_INPUT_BYTES)).rejects.toThrow('open probe');
    expect(open).toHaveBeenCalledWith(resolve('test-data', 'sample.pdf') + sep, expect.any(Number));
});

test.skipIf(process.platform === 'win32')('preserves symlink traversal before a parent component', async () => {
    const original = process.cwd();
    const folder = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-input-symlink-'));
    try {
        await fsPromises.mkdir(join(folder, 'target', 'nested'), { recursive: true });
        await fsPromises.symlink(join(folder, 'target', 'nested'), join(folder, 'link'));
        await fsPromises.writeFile(join(folder, 'target', 'report.pdf'), 'expected');
        process.chdir(folder);
        const bytes = await getPdfFileBuffer('link/../report.pdf', MAX_INPUT_BYTES);
        expect(Buffer.from(bytes).toString()).toBe('expected');
    } finally {
        process.chdir(original);
        await fsPromises.rm(folder, { recursive: true, force: true });
    }
});

test.skipIf(process.platform !== 'win32')('anchors drive-relative and current-drive-rooted paths on Windows', async () => {
    const drive = parse(process.cwd()).root.slice(0, 2);
    const failure = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const open = vi.spyOn(fsPromises, 'open').mockRejectedValue(failure);
    for (const input of [`${drive}report.pdf`, `${sep}report.pdf`]) {
        await expect(getPdfFileBuffer(input, MAX_INPUT_BYTES)).rejects.toBe(failure);
        expect(open).toHaveBeenLastCalledWith(resolve(input), expect.any(Number));
    }
});
