import { randomUUID } from 'node:crypto';
import { promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    const path = '/'.padEnd(MAX_PATH_CHARS, 'a');
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
