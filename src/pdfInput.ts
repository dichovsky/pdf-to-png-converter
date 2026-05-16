import { promises as fsPromises } from 'node:fs';

function rejectOversized(byteLength: number, maxInputBytes: number): void {
    if (byteLength > maxInputBytes) {
        throw new Error(`Input PDF exceeds maxInputBytes (${byteLength} > ${maxInputBytes} bytes)`);
    }
}

export async function getPdfFileBuffer(
    pdfFile: string | ArrayBufferLike | Uint8Array,
    maxInputBytes: number,
): Promise<Uint8Array | ArrayBufferLike> {
    if (typeof pdfFile === 'string') {
        const stats = await fsPromises.stat(pdfFile);
        if (!stats.isFile()) {
            throw new Error(`Input PDF path is not a regular file: ${pdfFile}`);
        }
        rejectOversized(stats.size, maxInputBytes);

        const buffer = await fsPromises.readFile(pdfFile);
        if (buffer instanceof ArrayBuffer) {
            return buffer;
        }
        if (Buffer.isBuffer(buffer)) {
            return new Uint8Array(buffer);
        }
        throw new Error(`Unsupported buffer type: ${Object.prototype.toString.call(buffer)}`);
    }

    if (Buffer.isBuffer(pdfFile)) {
        rejectOversized(pdfFile.byteLength, maxInputBytes);
        return new Uint8Array(pdfFile);
    }

    rejectOversized(pdfFile.byteLength, maxInputBytes);
    return pdfFile;
}
