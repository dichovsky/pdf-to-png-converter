import { promises as fsPromises } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MAX_INPUT_BYTES } from '../src/const';
import { getPdfFileBuffer } from '../src/pdfInput';
import { pdfToPng } from '../src/pdfToPng';

const SAMPLE_PDF = resolve('./test-data/sample.pdf');

beforeEach(() => {
    vi.restoreAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

test('pdfToPng rejects a path-based input larger than maxInputBytes before reading', async () => {
    await expect(pdfToPng(SAMPLE_PDF, { maxInputBytes: 100 })).rejects.toThrow(/exceeds maxInputBytes/);
});

test('pdfToPng accepts a path-based input within maxInputBytes', async () => {
    await expect(
        pdfToPng(SAMPLE_PDF, { maxInputBytes: MAX_INPUT_BYTES, returnMetadataOnly: true, pagesToProcess: [1] }),
    ).resolves.toHaveLength(1);
});

test('pdfToPng rejects a Uint8Array input larger than maxInputBytes', async () => {
    const oversized = new Uint8Array(1024);
    await expect(pdfToPng(oversized, { maxInputBytes: 100 })).rejects.toThrow(/exceeds maxInputBytes/);
});

test('pdfToPng rejects a Buffer input larger than maxInputBytes', async () => {
    const oversized = Buffer.alloc(1024);
    await expect(pdfToPng(oversized, { maxInputBytes: 100 })).rejects.toThrow(/exceeds maxInputBytes/);
});

test('getPdfFileBuffer rejects a path whose stat() reports it is not a regular file', async () => {
    const fakePath = '/dev/zero';
    const close = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(fsPromises, 'open').mockResolvedValueOnce({
        stat: vi.fn().mockResolvedValue({ size: 0, isFile: (): boolean => false }),
        close,
    } as unknown as FileHandle);

    await expect(getPdfFileBuffer(fakePath, MAX_INPUT_BYTES)).rejects.toThrow(/not a regular file/);
    expect(close).toHaveBeenCalledOnce();
});

test('getPdfFileBuffer rejects a path whose stat() reports size above maxInputBytes', async () => {
    const fakePath = join(tmpdir(), 'pretend-huge.pdf');
    const close = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(fsPromises, 'open').mockResolvedValueOnce({
        stat: vi.fn().mockResolvedValue({ size: MAX_INPUT_BYTES + 1, isFile: (): boolean => true }),
        close,
    } as unknown as FileHandle);

    await expect(getPdfFileBuffer(fakePath, MAX_INPUT_BYTES)).rejects.toThrow(/exceeds maxInputBytes/);
    expect(close).toHaveBeenCalledOnce();
});

test('getPdfFileBuffer reads a path within the size cap', async () => {
    const buffer = await getPdfFileBuffer(SAMPLE_PDF, MAX_INPUT_BYTES);
    expect(buffer.byteLength).toBeGreaterThan(0);
});

test('getPdfFileBuffer accepts a buffer at exactly maxInputBytes', async () => {
    const input = new Uint8Array(8);
    const result = await getPdfFileBuffer(input, 8);
    expect(result.byteLength).toBe(8);
});

test('getPdfFileBuffer rejects a buffer one byte above maxInputBytes', async () => {
    const input = new Uint8Array(9);
    await expect(getPdfFileBuffer(input, 8)).rejects.toThrow(/exceeds maxInputBytes/);
});

test('getPdfFileBuffer detects growth with a bounded read and closes the handle', async () => {
    const bytes = Buffer.alloc(1024, 7);
    const close = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn(async (target: Buffer, offset: number, length: number, position: number) => {
        const bytesRead = Math.min(length, Math.max(0, bytes.byteLength - position));
        bytes.copy(target, offset, position, position + bytesRead);
        return { bytesRead, buffer: target };
    });
    vi.spyOn(fsPromises, 'open').mockResolvedValueOnce({
        stat: vi.fn().mockResolvedValue({ size: 100, isFile: (): boolean => true }),
        read,
        close,
    } as unknown as FileHandle);

    await expect(getPdfFileBuffer('/pretend/grew-mid-read.pdf', 512)).rejects.toThrow('513 > 512 bytes');
    expect(close).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalled();
    for (const call of read.mock.calls) {
        const [, , length, position] = call;
        expect(length).toBeLessThanOrEqual(512);
        expect(position + length).toBeLessThanOrEqual(513);
    }
});

test('getPdfFileBuffer accepts growth up to exactly maxInputBytes', async () => {
    const bytes = Buffer.alloc(256, 9);
    const close = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn(async (target: Buffer, offset: number, length: number, position: number) => {
        const bytesRead = Math.min(length, Math.max(0, bytes.byteLength - position));
        bytes.copy(target, offset, position, position + bytesRead);
        return { bytesRead, buffer: target };
    });
    vi.spyOn(fsPromises, 'open').mockResolvedValueOnce({
        stat: vi.fn().mockResolvedValue({ size: 16, isFile: (): boolean => true }),
        read,
        close,
    } as unknown as FileHandle);

    const result = await getPdfFileBuffer('/pretend/grew-within-limit.pdf', bytes.byteLength);

    expect(result.byteLength).toBe(bytes.byteLength);
    expect(Buffer.from(result).equals(bytes)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
});
