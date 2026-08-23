import { constants as fsConstants, promises as fsPromises } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

const FILE_READ_GROWTH_BYTES = 64 * 1024;

function rejectOversized(byteLength: number, maxInputBytes: number): void {
    if (byteLength > maxInputBytes) {
        throw new Error(`Input PDF exceeds maxInputBytes (${byteLength} > ${maxInputBytes} bytes)`);
    }
}

/** An object exposing a finite numeric `length` — the shape pdf.js itself accepts as byte data. */
function isByteArrayLike(value: unknown): value is ArrayLike<number> {
    return typeof value === 'object' && value !== null && Number.isFinite((value as { length?: unknown }).length);
}

function toTransferableView(buffer: Buffer, byteLength: number): Uint8Array {
    // A full-span allocation is owned exclusively by this read, so pdf.js may transfer its
    // ArrayBuffer without a copy. A short read must be copied into an exact-size allocation: its
    // unused tail is uninitialized and must neither be exposed nor transferred.
    if (byteLength > 0 && byteLength === buffer.byteLength && buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength) {
        return new Uint8Array(buffer.buffer);
    }
    return Uint8Array.from(buffer.subarray(0, byteLength));
}

/**
 * Reads one already-open regular file without growing the destination buffer beyond the configured
 * cap; only a one-byte probe is read past the cap to distinguish exact-size EOF from overflow.
 * `FileHandle.readFile()` is deliberately not used: if the file grows after `fstat()`, it reads and
 * allocates through the new EOF before a post-read size check can enforce `maxInputBytes`.
 */
async function readBoundedFile(fileHandle: FileHandle, reportedSize: number, maxInputBytes: number): Promise<Uint8Array> {
    // allocUnsafeSlow produces a dedicated, full-span ArrayBuffer. That preserves the normal
    // stable-file zero-copy handoff without exposing bytes from Node's shared small-buffer pool.
    let buffer = Buffer.allocUnsafeSlow(reportedSize);
    let totalBytesRead = 0;

    while (true) {
        if (totalBytesRead === buffer.byteLength) {
            // A file may have grown since fstat(). Probe one byte past the current allocation to
            // distinguish EOF from growth without ever allocating an unbounded read buffer.
            const probe = Buffer.allocUnsafeSlow(1);
            const { bytesRead } = await fileHandle.read(probe, 0, 1, totalBytesRead);
            if (bytesRead === 0) {
                return toTransferableView(buffer, totalBytesRead);
            }
            if (totalBytesRead === maxInputBytes) {
                rejectOversized(totalBytesRead + 1, maxInputBytes);
            }

            const doubledCapacity = buffer.byteLength === 0 ? FILE_READ_GROWTH_BYTES : buffer.byteLength * 2;
            const nextCapacity = Math.min(maxInputBytes, Math.max(totalBytesRead + 1, doubledCapacity));
            const expanded = Buffer.allocUnsafeSlow(nextCapacity);
            buffer.copy(expanded, 0, 0, totalBytesRead);
            expanded[totalBytesRead] = probe[0];
            buffer = expanded;
            totalBytesRead += 1;
            continue;
        }

        const { bytesRead } = await fileHandle.read(buffer, totalBytesRead, buffer.byteLength - totalBytesRead, totalBytesRead);
        if (bytesRead === 0) {
            return toTransferableView(buffer, totalBytesRead);
        }
        totalBytesRead += bytesRead;
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
        // Open once, then inspect and read through that same descriptor. A path replacement after
        // open() cannot make validation apply to one file while bytes come from another.
        // O_NONBLOCK avoids waiting on special paths such as FIFOs on platforms that honor the
        // flag; fstat() then rejects anything non-regular. It has no effect on regular-file reads.
        const fileHandle = await fsPromises.open(pdfFile, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
        try {
            const stats = await fileHandle.stat();
            if (!stats.isFile()) {
                throw new Error(`Input PDF path is not a regular file: ${pdfFile}`);
            }
            rejectOversized(stats.size, maxInputBytes);
            return await readBoundedFile(fileHandle, stats.size, maxInputBytes);
        } finally {
            await fileHandle.close();
        }
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

    // The branches below are unreachable for TypeScript callers — the parameter type is exhausted
    // above — but `instanceof` is realm-bound, so genuine byte containers created in another realm
    // land here. pdf.js accepted all of these before this seam closed the union (`getDataProp`
    // takes anything satisfying `ArrayBuffer.isView` or having a numeric `length`, and the old
    // loader coerced the rest with `new Uint8Array(value)`), so they must keep converting.
    const candidate: unknown = pdfFile;

    // Cross-realm typed arrays and `DataView`s — e.g. built inside `node:vm` or `isolated-vm`,
    // where a real `Uint8Array` fails `instanceof` while still satisfying the declared type.
    if (ArrayBuffer.isView(candidate)) {
        return Uint8Array.from(new Uint8Array(candidate.buffer, candidate.byteOffset, candidate.byteLength));
    }

    // Cross-realm `ArrayBuffer`, for the same reason.
    if (Object.prototype.toString.call(candidate) === '[object ArrayBuffer]') {
        return Uint8Array.from(new Uint8Array(candidate as ArrayBuffer));
    }

    // Array-likes of byte values — most commonly a Node `Buffer` that round-tripped through JSON
    // as `{ type: 'Buffer', data: number[] }` and reaches us as that `data` array. `byteLength` is
    // `undefined` on these, so the size cap above skipped them; apply it to `length` here.
    if (isByteArrayLike(candidate)) {
        rejectOversized(candidate.length, maxInputBytes);
        return Uint8Array.from(candidate);
    }

    // Genuinely unsupported. Reject here with the same message the file-path branch uses, rather
    // than passing the value through for pdfjs to reject: this module owns the input contract, so
    // an unsupported shape must not escape it.
    throw new Error(`Unsupported buffer type: ${Object.prototype.toString.call(pdfFile)}`);
}
