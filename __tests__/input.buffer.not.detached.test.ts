import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pdfToPng } from '../src/pdfToPng';

// Regression: pdfjs `getDocument()` lists the input's underlying ArrayBuffer as a transferable,
// which detaches it (byteLength → 0) for full-span buffers. `getPdfFileBuffer` must defensively
// copy caller-owned `Uint8Array` / `ArrayBuffer` inputs so the caller's data survives the call
// and can be reused. See src/pdfInput.ts.
describe('input buffer is not detached by conversion', () => {
    const samplePath = 'test-data/sample.pdf';

    function readSampleAsUint8Array(): Uint8Array {
        const buf = readFileSync(samplePath);
        const u8 = new Uint8Array(buf.byteLength);
        u8.set(buf);
        return u8;
    }

    it('does not detach a full-span Uint8Array input', async () => {
        const input = readSampleAsUint8Array();
        const originalByteLength = input.byteLength;

        await pdfToPng(input, { returnMetadataOnly: true });

        expect(input.byteLength).toBe(originalByteLength);
        expect(input.buffer.byteLength).toBe(originalByteLength);
    });

    it('does not detach the backing buffer of a subarray (partial-view) Uint8Array input', async () => {
        const sample = readSampleAsUint8Array();
        // A view into a larger allocation: its `.buffer` is shared with `backing`.
        const backing = new ArrayBuffer(sample.byteLength + 64);
        const view = new Uint8Array(backing, 32, sample.byteLength);
        view.set(sample);
        const originalBackingLength = backing.byteLength;

        await pdfToPng(view, { returnMetadataOnly: true });

        // The parent allocation must survive — the copy must not reference `backing`.
        expect(backing.byteLength).toBe(originalBackingLength);
        expect(view.byteLength).toBe(sample.byteLength);
    });

    it('does not detach an ArrayBuffer input', async () => {
        const buf = readFileSync(samplePath);
        const input: ArrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        const originalByteLength = input.byteLength;

        await pdfToPng(input, { returnMetadataOnly: true });

        expect(input.byteLength).toBe(originalByteLength);
    });

    it('does not detach or mutate a Node Buffer input', async () => {
        const input = readFileSync(samplePath);
        const originalByteLength = input.byteLength;
        const originalCopy = Uint8Array.from(input);

        await pdfToPng(input, { returnMetadataOnly: true });

        expect(input.byteLength).toBe(originalByteLength);
        expect(Uint8Array.from(input)).toEqual(originalCopy);
    });

    it('allows the same Uint8Array to be reused for multiple conversions', async () => {
        const input = readSampleAsUint8Array();

        const first = await pdfToPng(input, { returnMetadataOnly: true });
        const second = await pdfToPng(input, { returnMetadataOnly: true });

        expect(second.length).toBe(first.length);
        expect(second.length).toBeGreaterThan(0);
    });
});
