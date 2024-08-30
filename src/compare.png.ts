import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'node:path';
import comparePng, { ComparePngOptions } from 'png-visual-compare';

/**
 * Compares a PNG image with an expected PNG image.
 * If the expected image does not exist, it creates it by copying the actual image.
 * @param actualFilePathOrBuffer - The path or buffer of the actual PNG image.
 * @param expectedFilePath - The path of the expected PNG image.
 * @param opts - Optional compare options.
 * @returns A promise that resolves to the comparison result.
 */
export function comparePNG(
    actualFilePathOrBuffer: string | Buffer,
    expectedFilePath: string,
    opts?: ComparePngOptions,
) {
    if (!existsSync(expectedFilePath)) {
        const expectedFileDir = parse(expectedFilePath).dir;
        if (!existsSync(expectedFileDir)) {
            mkdirSync(expectedFileDir, { recursive: true });
        }
        const actualBuffer: Buffer =
            typeof actualFilePathOrBuffer === 'string' ? readFileSync(actualFilePathOrBuffer) : actualFilePathOrBuffer;
        writeFileSync(expectedFilePath, actualBuffer);
    }
    return comparePng(actualFilePathOrBuffer, expectedFilePath, opts);
}
