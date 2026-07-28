import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
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
