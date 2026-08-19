import type { FileHandle } from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';
import { getPdfFileBuffer } from '../src/pdfInput';

vi.mock('node:fs', () => ({
    constants: { O_RDONLY: 0, O_NONBLOCK: 4 },
    promises: { open: vi.fn() },
}));

import { promises as fsPromises } from 'node:fs';

const openMock = vi.mocked(fsPromises.open);

interface MockFile {
    readonly handle: FileHandle;
    readonly stat: ReturnType<typeof vi.fn>;
    readonly read: ReturnType<typeof vi.fn>;
    readonly close: ReturnType<typeof vi.fn>;
    firstReadBuffer?: Buffer;
}

function mockFile(bytes: Buffer, reportedSize = bytes.byteLength): MockFile {
    const result: MockFile = {
        handle: undefined as unknown as FileHandle,
        stat: vi.fn().mockResolvedValue({ isFile: (): boolean => true, size: reportedSize }),
        read: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
    };
    result.read.mockImplementation(async (target: Buffer, offset: number, length: number, position: number) => {
        result.firstReadBuffer ??= target;
        const bytesRead = Math.min(length, Math.max(0, bytes.byteLength - position));
        bytes.copy(target, offset, position, position + bytesRead);
        return { bytesRead, buffer: target };
    });
    Object.assign(result, { handle: { stat: result.stat, read: result.read, close: result.close } as unknown as FileHandle });
    openMock.mockResolvedValueOnce(result.handle);
    return result;
}

afterEach(() => {
    vi.resetAllMocks();
});

test('stable file-path input transfers the dedicated read allocation without copying', async () => {
    const raw = Buffer.alloc(8, 7);
    const file = mockFile(raw);

    const result = await getPdfFileBuffer('/fake/file.pdf', 1024);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.buffer).toBe(file.firstReadBuffer?.buffer);
    expect(Array.from(result)).toEqual(Array.from(raw));
    expect(file.close).toHaveBeenCalledOnce();
});

test('file-path input copies an exact-size result when the file shrinks after fstat', async () => {
    const raw = Buffer.alloc(8, 5);
    const file = mockFile(raw, 32);

    const result = await getPdfFileBuffer('/fake/file.pdf', 1024);

    expect(result.buffer).not.toBe(file.firstReadBuffer?.buffer);
    expect(result.byteLength).toBe(raw.byteLength);
    expect(Array.from(result)).toEqual(Array.from(raw));
});

test('empty file-path input returns a plain empty Uint8Array', async () => {
    mockFile(Buffer.alloc(0), 0);

    const result = await getPdfFileBuffer('/fake/file.pdf', 1024);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBe(0);
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
});

test('path input validates and reads through exactly one opened handle', async () => {
    const file = mockFile(Buffer.from([1, 2, 3]));

    await getPdfFileBuffer('/fake/file.pdf', 1024);

    expect(openMock).toHaveBeenCalledOnce();
    expect(openMock).toHaveBeenCalledWith('/fake/file.pdf', 4);
    expect(file.stat).toHaveBeenCalledOnce();
    expect(file.read).toHaveBeenCalled();
    expect(file.close).toHaveBeenCalledOnce();
});

test('opened file handle closes when fstat fails', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const failure = new Error('fstat failed');
    openMock.mockResolvedValueOnce({ stat: vi.fn().mockRejectedValue(failure), close } as unknown as FileHandle);

    await expect(getPdfFileBuffer('/fake/file.pdf', 1024)).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
});

test('opened file handle closes when a read fails', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const failure = new Error('read failed');
    openMock.mockResolvedValueOnce({
        stat: vi.fn().mockResolvedValue({ isFile: (): boolean => true, size: 8 }),
        read: vi.fn().mockRejectedValue(failure),
        close,
    } as unknown as FileHandle);

    await expect(getPdfFileBuffer('/fake/file.pdf', 1024)).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
});
