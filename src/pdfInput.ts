import { promises as fsPromises } from 'node:fs';

export async function getPdfFileBuffer(pdfFile: string | ArrayBufferLike | Uint8Array): Promise<Uint8Array | ArrayBufferLike> {
    if (typeof pdfFile === 'string') {
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
        return new Uint8Array(pdfFile);
    }

    return pdfFile;
}
