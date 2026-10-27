import { constants as fsConstants, promises as fsPromises } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

const FILE_READ_GROWTH_BYTES = 64 * 1024;

// FileHandle.read() takes an int32 `length`, so a request of 2 GiB or more is unsafe: depending on the
// Node version it aborts the process (a failed C++ CHECK) or throws ERR_OUT_OF_RANGE, and a multiple
// of 4 GiB wraps to a zero-length read that the read loop would take for EOF and return a silently
// short buffer. No single request may exceed this; the loop already assembles a file from short reads.
const FILE_READ_MAX_CHUNK_BYTES = 2 ** 30;

// POSIX PATH_MAX on Linux. A longer string cannot be a usable path: it is document content passed by
// mistake, and the filesystem error for it would copy the whole value into its message. Windows
// extended-length paths (up to 32,767 characters) are therefore not accepted as string input; raise
// this if that is ever needed.
const MAX_INPUT_PATH_LENGTH = 4096;

function rejectOversized(byteLength: number, maxInputBytes: number): void {
    if (byteLength > maxInputBytes) {
        throw new Error(`Input PDF exceeds maxInputBytes (${byteLength} > ${maxInputBytes} bytes)`);
    }
}

function unsupportedBufferError(value: unknown): Error {
    return new Error(`Unsupported buffer type: ${Object.prototype.toString.call(value)}`);
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

        const requestLength = Math.min(buffer.byteLength - totalBytesRead, FILE_READ_MAX_CHUNK_BYTES);
        const { bytesRead } = await fileHandle.read(buffer, totalBytesRead, requestLength, totalBytesRead);
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
        // Checked before any filesystem call, and the value is deliberately not echoed.
        if (pdfFile.length > MAX_INPUT_PATH_LENGTH) {
            throw new Error(
                `Input PDF path is too long (over ${MAX_INPUT_PATH_LENGTH} characters). A string is read as a file path; pass PDF bytes as a Buffer or Uint8Array.`,
            );
        }
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

    // Not a path, so it must be a byte container. null, undefined and other primitives are not one:
    // reject them here rather than let the `byteLength` read below fail as an engine TypeError.
    if (typeof pdfFile !== 'object' || pdfFile === null) {
        throw unsupportedBufferError(pdfFile);
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
    // loader coerced the rest with `new Uint8Array(value)`), so they must keep converting — except
    // an object that merely claims a numeric `length`, which only a real Array may do (see below).
    const candidate: unknown = pdfFile;

    // Cross-realm typed arrays and `DataView`s — e.g. built inside `node:vm` or `isolated-vm`,
    // where a real `Uint8Array` fails `instanceof` while still satisfying the declared type.
    if (ArrayBuffer.isView(candidate)) {
        return Uint8Array.from(new Uint8Array(candidate.buffer, candidate.byteOffset, candidate.byteLength));
    }

    // Cross-realm `ArrayBuffer` and `SharedArrayBuffer`, for the same reason. `Uint8Array.from`
    // copies, so a shared buffer also leaves here as unshared memory.
    const tag = Object.prototype.toString.call(candidate);
    if (tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]') {
        return Uint8Array.from(new Uint8Array(candidate as ArrayBuffer));
    }

    // Arrays of byte values — most commonly a Node `Buffer` that round-tripped through JSON as
    // `{ type: 'Buffer', data: number[] }` and reaches us as that `data` array. `byteLength` is
    // `undefined` on these, so the size cap above skipped them; apply it to `length` here. Only a
    // genuine Array qualifies (`Array.isArray` is realm-independent): the cap bounds the length an
    // object CLAIMS, not the work of copying it, and `Uint8Array.from({ length: n })` performs n
    // property reads, so a 20-byte `{"length":268435456}` would block the event loop for seconds.
    if (Array.isArray(candidate)) {
        rejectOversized(candidate.length, maxInputBytes);
        return Uint8Array.from(candidate);
    }

    // Genuinely unsupported. Reject here rather than passing the value through for pdfjs to reject:
    // this module owns the input contract, so an unsupported shape must not escape it.
    throw unsupportedBufferError(pdfFile);
}
