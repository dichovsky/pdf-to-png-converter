import { promises as fsPromises } from 'node:fs';

function rejectOversized(byteLength: number, maxInputBytes: number): void {
    if (byteLength > maxInputBytes) {
        throw new Error(`Input PDF exceeds maxInputBytes (${byteLength} > ${maxInputBytes} bytes)`);
    }
}

/**
 * Normalizes every supported input shape to a `Uint8Array` that pdfjs may safely transfer
 * (detach). Closing the return type here means this module is the single owner of "what shape we
 * hand pdfjs" — downstream seams (`getPdfDocument`, the worker dispatch) take a `Uint8Array` and
 * re-derive nothing.
 */
export async function getPdfFileBuffer(pdfFile: string | ArrayBufferLike | Uint8Array, maxInputBytes: number): Promise<Uint8Array> {
    if (typeof pdfFile === 'string') {
        const stats = await fsPromises.stat(pdfFile);
        if (!stats.isFile()) {
            throw new Error(`Input PDF path is not a regular file: ${pdfFile}`);
        }
        rejectOversized(stats.size, maxInputBytes);

        const buffer = await fsPromises.readFile(pdfFile);
        // Post-read re-check: closes the TOCTOU window between stat() and readFile().
        // If the file was replaced or grew between the two calls, the buffer may exceed
        // maxInputBytes — reject it before it propagates further into pdfjs parsing.
        rejectOversized(buffer.byteLength, maxInputBytes);
        if (buffer instanceof ArrayBuffer) {
            // Fresh allocation owned by this call — a full-span view is safe to hand over.
            return new Uint8Array(buffer);
        }
        if (Buffer.isBuffer(buffer)) {
            // Zero-copy handoff. This Buffer was freshly allocated by readFile and is never
            // exposed to the caller, so pdfjs may safely transfer (detach) its underlying
            // ArrayBuffer — unlike the caller-owned branches below, no defensive copy is needed.
            // readFile allocates non-pooled memory today; the full-span guard protects against
            // any future pooled allocation whose ArrayBuffer is shared with unrelated data.
            // Empty (or detached, byteLength 0) buffers take the copy path so pdfjs raises its
            // clear "empty PDF" error instead of an opaque constructor TypeError.
            if (buffer.byteLength > 0 && buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength) {
                return new Uint8Array(buffer.buffer);
            }
            return new Uint8Array(buffer);
        }
        throw new Error(`Unsupported buffer type: ${Object.prototype.toString.call(buffer)}`);
    }

    if (Buffer.isBuffer(pdfFile)) {
        rejectOversized(pdfFile.byteLength, maxInputBytes);
        return new Uint8Array(pdfFile);
    }

    rejectOversized(pdfFile.byteLength, maxInputBytes);
    // Defensive copy. pdfjs `getDocument()` lists the input's underlying ArrayBuffer as a
    // transferable, which DETACHES it (byteLength → 0) when the data is a full-span Uint8Array.
    // Returning the caller's buffer by reference would therefore neuter their input and break
    // reuse across calls. The string-path and Node-Buffer branches above already allocate fresh
    // memory; copy the Uint8Array / ArrayBuffer branch too so every supported input shape leaves
    // the caller's buffer intact.
    if (pdfFile instanceof Uint8Array) {
        return Uint8Array.from(pdfFile);
    }
    if (pdfFile instanceof ArrayBuffer) {
        return new Uint8Array(pdfFile.slice(0));
    }
    if (pdfFile instanceof SharedArrayBuffer) {
        // `slice()` would yield another SharedArrayBuffer (non-transferable, shared) — copy into a
        // fresh, regular-ArrayBuffer-backed Uint8Array so downstream pdfjs always receives
        // unshared memory. `new Uint8Array(sab)` only views the SAB, so copy via `Uint8Array.from`.
        return Uint8Array.from(new Uint8Array(pdfFile));
    }

    // Out of contract for TypeScript callers (the parameter type covers every branch above), but
    // reachable from JavaScript. Reject here with the same message the file-path branch uses,
    // rather than passing the value through for pdfjs to reject: this module owns the input
    // contract, so an unsupported shape must not escape it.
    throw new Error(`Unsupported buffer type: ${Object.prototype.toString.call(pdfFile)}`);
}
