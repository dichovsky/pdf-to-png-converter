import { afterEach, expect, test, vi } from 'vitest';
import { getPdfFileBuffer } from '../src/pdfInput';

vi.mock('node:fs', () => ({
    promises: { stat: vi.fn(), readFile: vi.fn() },
}));

import { promises as fsPromises } from 'node:fs';

const statMock = vi.mocked(fsPromises.stat);
const readFileMock = vi.mocked(fsPromises.readFile);

function mockStat(size: number): void {
    statMock.mockResolvedValue({ isFile: () => true, size } as never);
}

afterEach(() => {
    vi.resetAllMocks();
});

test('file-path input hands the readFile buffer to pdfjs without copying when it spans its ArrayBuffer', async () => {
    // Buffer.alloc yields a full-span, non-pooled Buffer — the normal readFile shape.
    const raw = Buffer.alloc(8, 7);
    mockStat(raw.byteLength);
    readFileMock.mockResolvedValue(raw as never);

    const result = await getPdfFileBuffer('/fake/file.pdf', 1024);

    expect(result).toBeInstanceOf(Uint8Array);
    // Zero-copy: the returned view shares the readFile buffer's memory.
    expect((result as Uint8Array).buffer).toBe(raw.buffer);
    expect(Array.from(result as Uint8Array)).toEqual(Array.from(raw));
});

test('file-path input copies when the readFile buffer starts at offset 0 but does not span its ArrayBuffer', async () => {
    // Offset 0 but shorter than the backing store: the byteLength half of the guard must catch it.
    const backing = new ArrayBuffer(32);
    new Uint8Array(backing).fill(9);
    const pooled = Buffer.from(backing, 0, 8);
    pooled.fill(5);
    mockStat(pooled.byteLength);
    readFileMock.mockResolvedValue(pooled as never);

    const result = await getPdfFileBuffer('/fake/file.pdf', 1024);

    expect(result).toBeInstanceOf(Uint8Array);
    expect((result as Uint8Array).buffer).not.toBe(backing);
    expect((result as Uint8Array).byteLength).toBe(8);
    expect(Array.from(result as Uint8Array)).toEqual(Array.from(pooled));
});

test('file-path input copies an empty readFile buffer so pdfjs sees a plain empty input', async () => {
    const empty = Buffer.alloc(0);
    mockStat(0);
    readFileMock.mockResolvedValue(empty as never);

    const result = await getPdfFileBuffer('/fake/file.pdf', 1024);

    expect(result).toBeInstanceOf(Uint8Array);
    expect((result as Uint8Array).byteLength).toBe(0);
    // Guard requires byteLength > 0 — empty buffers must take the copy path.
    expect((result as Uint8Array).buffer).not.toBe(empty.buffer);
});

test('file-path input copies when the readFile buffer shares its ArrayBuffer with other data', async () => {
    // Simulate a pooled allocation: a Buffer view at a non-zero offset of a larger ArrayBuffer.
    const backing = new ArrayBuffer(32);
    new Uint8Array(backing).fill(9);
    const pooled = Buffer.from(backing, 8, 8);
    pooled.fill(5);
    mockStat(pooled.byteLength);
    readFileMock.mockResolvedValue(pooled as never);

    const result = await getPdfFileBuffer('/fake/file.pdf', 1024);

    expect(result).toBeInstanceOf(Uint8Array);
    // A shared backing store must NOT be handed to pdfjs (which detaches it) — expect a copy.
    expect((result as Uint8Array).buffer).not.toBe(backing);
    expect(Array.from(result as Uint8Array)).toEqual(Array.from(pooled));
});
