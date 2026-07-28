import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { pdfToPng } from '../src';
import { MAX_INPUT_BYTES } from '../src/const';
import { getPdfFileBuffer } from '../src/pdfInput';

// ARCH-014: getPdfFileBuffer is the single owner of "what shape we hand pdfjs". Every supported
// input must leave this seam as a Uint8Array so downstream modules re-derive nothing.

const SAMPLE_PDF = resolve('./test-data/sample.pdf');

test('returns a Uint8Array for a file path', async () => {
    const result = await getPdfFileBuffer(SAMPLE_PDF, MAX_INPUT_BYTES);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBeGreaterThan(0);
});

test('returns a Uint8Array for a Node Buffer', async () => {
    const input = readFileSync(SAMPLE_PDF);
    const result = await getPdfFileBuffer(input, MAX_INPUT_BYTES);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBe(input.byteLength);
});

test('returns a Uint8Array for a Uint8Array', async () => {
    const input = Uint8Array.from(readFileSync(SAMPLE_PDF));
    const result = await getPdfFileBuffer(input, MAX_INPUT_BYTES);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBe(input.byteLength);
});

test('returns a Uint8Array — not a bare ArrayBuffer — for an ArrayBuffer input', async () => {
    const buf = readFileSync(SAMPLE_PDF);
    const input: ArrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const result = await getPdfFileBuffer(input, MAX_INPUT_BYTES);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBe(input.byteLength);
    // Defensive copy: the caller's ArrayBuffer must not back the returned view.
    expect(result.buffer).not.toBe(input);
});

test('returns an unshared Uint8Array for a SharedArrayBuffer input', async () => {
    const source = Uint8Array.from(readFileSync(SAMPLE_PDF));
    const input = new SharedArrayBuffer(source.byteLength);
    new Uint8Array(input).set(source);

    const result = await getPdfFileBuffer(input, MAX_INPUT_BYTES);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
    expect(result.buffer).not.toBeInstanceOf(SharedArrayBuffer);
});

test('rejects an out-of-contract input shape instead of passing it through to pdfjs', async () => {
    // Reachable from JavaScript callers only — the TypeScript signature covers every branch above.
    const notABuffer = { byteLength: 4 } as unknown as ArrayBufferLike;
    await expect(getPdfFileBuffer(notABuffer, MAX_INPUT_BYTES)).rejects.toThrow(/Unsupported buffer type/);
});

// Closing the return type must not narrow what the library ACCEPTS. `instanceof` is realm-bound
// and pdf.js itself took anything satisfying `ArrayBuffer.isView` or carrying a numeric `length`,
// so these shapes converted before the union was closed and must keep converting.

test('accepts a cross-realm Uint8Array, which fails instanceof', async () => {
    const source = Uint8Array.from(readFileSync(SAMPLE_PDF));
    const foreign = runInNewContext('new Uint8Array(len)', { len: source.byteLength }) as Uint8Array;
    foreign.set(source);
    expect(foreign instanceof Uint8Array).toBe(false);

    const result = await getPdfFileBuffer(foreign, MAX_INPUT_BYTES);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBe(source.byteLength);
});

test('accepts a cross-realm ArrayBuffer, which fails instanceof', async () => {
    const source = Uint8Array.from(readFileSync(SAMPLE_PDF));
    const foreign = runInNewContext('new ArrayBuffer(len)', { len: source.byteLength }) as ArrayBuffer;
    new Uint8Array(foreign).set(source);
    expect(foreign instanceof ArrayBuffer).toBe(false);

    const result = await getPdfFileBuffer(foreign, MAX_INPUT_BYTES);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBe(source.byteLength);
});

test('accepts a Uint8ClampedArray and a DataView', async () => {
    const source = Uint8Array.from(readFileSync(SAMPLE_PDF));

    const clamped = Uint8ClampedArray.from(source) as unknown as Uint8Array;
    expect((await getPdfFileBuffer(clamped, MAX_INPUT_BYTES)).byteLength).toBe(source.byteLength);

    const view = new DataView(source.buffer.slice(0)) as unknown as ArrayBufferLike;
    expect((await getPdfFileBuffer(view, MAX_INPUT_BYTES)).byteLength).toBe(source.byteLength);
});

test('accepts a byte array-like, e.g. a Buffer that round-tripped through JSON', async () => {
    const source = readFileSync(SAMPLE_PDF);
    // `JSON.parse(JSON.stringify(buffer))` yields `{ type: 'Buffer', data: number[] }`.
    const roundTripped = JSON.parse(JSON.stringify(source)) as { data: number[] };
    const result = await getPdfFileBuffer(roundTripped.data as unknown as ArrayBufferLike, MAX_INPUT_BYTES);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBe(source.byteLength);
    expect(Buffer.from(result).equals(source)).toBe(true);
});

test('applies maxInputBytes to a byte array-like, which carries no byteLength', async () => {
    const oversized = new Array<number>(16).fill(0) as unknown as ArrayBufferLike;
    await expect(getPdfFileBuffer(oversized, 8)).rejects.toThrow(/exceeds maxInputBytes/);
});

test('a cross-realm Uint8Array converts end to end', async () => {
    const source = Uint8Array.from(readFileSync(SAMPLE_PDF));
    const foreign = runInNewContext('new Uint8Array(len)', { len: source.byteLength }) as Uint8Array;
    foreign.set(source);

    const pages = await pdfToPng(foreign, { returnMetadataOnly: true });
    expect(pages).toHaveLength(2);
});
