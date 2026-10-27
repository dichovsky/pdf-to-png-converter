import { promises as fsPromises, readFileSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { pdfToPng } from '../src';
import { prepareOutputFolder, resolveOutputFolder, savePNGfile } from '../src/outputWriter';
import type { OutputFolderHandle } from '../src/outputWriter';

// Once the exclusive-create open succeeds, the file exists and this call created it. These tests let
// the real 'wx' open create that file and then break the returned handle, so cleanup runs against a
// real file on disk instead of a mock.

const realOpen = fsPromises.open;
const PNG_BYTES = Buffer.from('pretend png payload');
const PARTIAL_BYTES = PNG_BYTES.subarray(0, 7);
const WRITE_ERROR = Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
const CLOSE_ERROR = Object.assign(new Error('EIO: i/o error, close'), { code: 'EIO' });

let baseDir: string;
let folder: OutputFolderHandle;

beforeEach(async () => {
    baseDir = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-failed-write-'));
    folder = await prepareOutputFolder(resolveOutputFolder(baseDir));
});

afterEach(async () => {
    vi.restoreAllMocks();
    await fsPromises.rm(baseDir, { recursive: true, force: true });
});

/** Breaks only the handle returned by the first exclusive-create open; later opens stay real. */
function breakNextExclusiveHandle(...faults: Array<(handle: FileHandle) => void>): void {
    let armed = true;
    vi.spyOn(fsPromises, 'open').mockImplementation(async (...args: Parameters<typeof realOpen>) => {
        const handle = await realOpen(...args);
        if (armed && args[1] === 'wx') {
            armed = false;
            for (const fault of faults) fault(handle);
        }
        return handle;
    });
}

/** Writes a prefix first, so the failed write leaves a truncated file under the final name. */
function failingWrite(error: Error): (handle: FileHandle) => void {
    return (handle) => {
        vi.spyOn(handle, 'writeFile').mockImplementation(async () => {
            await handle.write(PARTIAL_BYTES);
            throw error;
        });
    };
}

/** Closes the descriptor for real, then reports the failure, so the test does not leak it. */
function failingClose(error: Error): (handle: FileHandle) => void {
    return (handle) => {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => {
            await close();
            throw error;
        });
    };
}

test('removes the truncated file and rethrows the original error when the write fails', async () => {
    breakNextExclusiveHandle(failingWrite(WRITE_ERROR));

    await expect(savePNGfile('page.png', PNG_BYTES, folder)).rejects.toBe(WRITE_ERROR);

    await expect(fsPromises.readdir(baseDir)).resolves.toEqual([]);
});

test('removes the file and rethrows the original error when the close fails after a complete write', async () => {
    breakNextExclusiveHandle(failingClose(CLOSE_ERROR));

    await expect(savePNGfile('page.png', PNG_BYTES, folder)).rejects.toBe(CLOSE_ERROR);

    await expect(fsPromises.readdir(baseDir)).resolves.toEqual([]);
});

test('rethrows the write error, not the close error, when both fail', async () => {
    breakNextExclusiveHandle(failingWrite(WRITE_ERROR), failingClose(CLOSE_ERROR));

    await expect(savePNGfile('page.png', PNG_BYTES, folder)).rejects.toBe(WRITE_ERROR);

    await expect(fsPromises.readdir(baseDir)).resolves.toEqual([]);
});

test('allows the same name to be written again after a failed write', async () => {
    breakNextExclusiveHandle(failingWrite(WRITE_ERROR));
    await expect(savePNGfile('page.png', PNG_BYTES, folder)).rejects.toBe(WRITE_ERROR);

    const path = await savePNGfile('page.png', PNG_BYTES, folder);

    expect(path).toBe(join(baseDir, 'page.png'));
    await expect(fsPromises.readFile(path)).resolves.toEqual(PNG_BYTES);
});

test('rethrows the original error even when removing the leftover file also fails', async () => {
    const unlinkError = Object.assign(new Error('EPERM: operation not permitted, unlink'), { code: 'EPERM' });
    const unlink = vi.spyOn(fsPromises, 'unlink').mockRejectedValueOnce(unlinkError);
    breakNextExclusiveHandle(failingWrite(WRITE_ERROR));

    await expect(savePNGfile('page.png', PNG_BYTES, folder)).rejects.toBe(WRITE_ERROR);

    expect(unlink).toHaveBeenCalledExactlyOnceWith(join(baseDir, 'page.png'));
});

test('never removes a pre-existing file when the exclusive open fails with EEXIST', async () => {
    const existingPath = join(baseDir, 'page.png');
    await fsPromises.writeFile(existingPath, 'owned by someone else');
    const unlink = vi.spyOn(fsPromises, 'unlink');

    await expect(savePNGfile('page.png', PNG_BYTES, folder)).rejects.toMatchObject({ code: 'EEXIST' });

    expect(unlink).not.toHaveBeenCalled();
    await expect(fsPromises.readFile(existingPath, 'utf8')).resolves.toBe('owned by someone else');
});

test('pdfToPng leaves no truncated PNG behind when a page write fails, so the same folder can be reused', async () => {
    const pdfBytes = readFileSync(resolve('./test-data/sample.pdf'));
    const options = { outputFolder: baseDir, pagesToProcess: [1], returnPageContent: false };
    breakNextExclusiveHandle(failingWrite(WRITE_ERROR));

    await expect(pdfToPng(pdfBytes, options)).rejects.toBe(WRITE_ERROR);
    await expect(fsPromises.readdir(baseDir)).resolves.toEqual([]);

    const pages = await pdfToPng(pdfBytes, options);

    expect(pages.map((page) => page.name)).toEqual(['buffer_page_1.png']);
    expect((await fsPromises.stat(join(baseDir, 'buffer_page_1.png'))).size).toBeGreaterThan(PARTIAL_BYTES.length);
});
