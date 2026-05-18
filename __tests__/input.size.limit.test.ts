import { promises as fsPromises } from 'node:fs';
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
    vi.spyOn(fsPromises, 'stat').mockResolvedValueOnce({
        size: 0,
        isFile: (): boolean => false,
    } as Awaited<ReturnType<typeof fsPromises.stat>>);

    await expect(getPdfFileBuffer(fakePath, MAX_INPUT_BYTES)).rejects.toThrow(/not a regular file/);
});

test('getPdfFileBuffer rejects a path whose stat() reports size above maxInputBytes', async () => {
    const fakePath = join(tmpdir(), 'pretend-huge.pdf');
    vi.spyOn(fsPromises, 'stat').mockResolvedValueOnce({
        size: MAX_INPUT_BYTES + 1,
        isFile: (): boolean => true,
    } as Awaited<ReturnType<typeof fsPromises.stat>>);

    await expect(getPdfFileBuffer(fakePath, MAX_INPUT_BYTES)).rejects.toThrow(/exceeds maxInputBytes/);
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

test('getPdfFileBuffer rejects when the file grows between stat() and readFile() (TOCTOU)', async () => {
    // Pre-check sees a 100-byte file (passes), but readFile() returns a 1 KiB buffer —
    // simulating an attacker growing the file between the two syscalls. The post-read
    // re-check must reject the oversized payload.
    vi.spyOn(fsPromises, 'stat').mockResolvedValueOnce({
        size: 100,
        isFile: (): boolean => true,
    } as Awaited<ReturnType<typeof fsPromises.stat>>);
    (vi.spyOn(fsPromises, 'readFile') as unknown as { mockResolvedValueOnce: (value: unknown) => unknown }).mockResolvedValueOnce(
        Buffer.alloc(1024),
    );

    await expect(getPdfFileBuffer('/pretend/grew-mid-read.pdf', 512)).rejects.toThrow(/exceeds maxInputBytes/);
});
