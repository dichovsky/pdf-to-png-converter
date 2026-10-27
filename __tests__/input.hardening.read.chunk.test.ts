import { promises as fsPromises } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';
import { getPdfFileBuffer } from '../src/pdfInput';

// FileHandle.read() takes an int32 `length`, so a request of 2 GiB or more is unsafe: depending on
// the Node version it aborts the process (a failed C++ CHECK) or throws ERR_OUT_OF_RANGE, and a
// multiple of 4 GiB wraps to a zero-length read that the read loop would mistake for EOF. These
// tests prove the request size is bounded without a multi-GiB file or allocation: the FileHandle is
// a stub, and for the huge-file case Buffer.allocUnsafeSlow hands back a small buffer that only
// claims the span.

const INT32_MAX = 2 ** 31 - 1;
const FAKE_PATH = '/pretend/huge.pdf';

type ReadStub = (target: Buffer, offset: number, length: number, position: number) => Promise<{ bytesRead: number; buffer: Buffer }>;

afterEach(() => {
    vi.restoreAllMocks();
});

function stubFile(size: number, read: ReturnType<typeof vi.fn<ReadStub>>): ReturnType<typeof vi.fn> {
    const close = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(fsPromises, 'open').mockResolvedValueOnce({
        stat: vi.fn().mockResolvedValue({ size, isFile: (): boolean => true }),
        read,
        close,
    } as unknown as FileHandle);
    return close;
}

test('splits a file of more than 2 GiB into read requests that fit an int32 length', async () => {
    const size = 2 ** 31 + 4096;
    // Claim the full span without allocating it: only `byteLength` is overridden.
    const standIn = Buffer.alloc(4096);
    Object.defineProperty(standIn, 'byteLength', { value: size });
    const realAllocUnsafeSlow = Buffer.allocUnsafeSlow.bind(Buffer);
    vi.spyOn(Buffer, 'allocUnsafeSlow').mockImplementation((requested: number) =>
        requested === size ? standIn : realAllocUnsafeSlow(requested),
    );
    const read = vi.fn<ReadStub>(async (target, _offset, length, position) => ({
        bytesRead: Math.min(length, Math.max(0, size - position)),
        buffer: target,
    }));
    const close = stubFile(size, read);

    await expect(getPdfFileBuffer(FAKE_PATH, 2 ** 32)).resolves.toBeInstanceOf(Uint8Array);

    for (const [, , length] of read.mock.calls) {
        expect(length).toBeLessThanOrEqual(INT32_MAX);
    }
    // The requests tile the file with no gap or overlap, so nothing is dropped or read twice.
    let covered = 0;
    for (const [, offset, length, position] of read.mock.calls.filter(([, , , at]) => at < size)) {
        expect(position).toBe(covered);
        expect(offset).toBe(covered);
        covered += length;
    }
    expect(covered).toBe(size);
    expect(close).toHaveBeenCalledOnce();
});

test('assembles a file from short reads', async () => {
    const bytes = Buffer.from('0123456789abcdef');
    const read = vi.fn<ReadStub>(async (target, offset, length, position) => {
        const bytesRead = Math.min(length, 3, Math.max(0, bytes.byteLength - position));
        bytes.copy(target, offset, position, position + bytesRead);
        return { bytesRead, buffer: target };
    });
    const close = stubFile(bytes.byteLength, read);

    const result = await getPdfFileBuffer(FAKE_PATH, 1024);

    expect(Buffer.from(result).equals(bytes)).toBe(true);
    expect(read.mock.calls.length).toBeGreaterThan(Math.ceil(bytes.byteLength / 3));
    expect(close).toHaveBeenCalledOnce();
});
