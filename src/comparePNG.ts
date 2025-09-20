import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'node:path';
import { type ComparePngOptions, comparePng } from 'png-visual-compare';

/**
 * Compares a PNG image with an expected PNG image.
 * If the expected image does not exist, it creates it by copying the actual image.
 * @param actualFile - The path or buffer of the actual PNG image.
 * @param expectedFile - The path of the expected PNG image.
 * @param opts - Optional compare options.
 * @returns A promise that resolves to the comparison result.
 */
export function comparePNG({
    actualFile,
    expectedFile,
    createExpectedFileIfMissing,
    opts,
}: {
    actualFile: string | Buffer;
    expectedFile: string;
    createExpectedFileIfMissing: boolean;
    opts?: ComparePngOptions;
}) {
    if (createExpectedFileIfMissing && !existsSync(expectedFile)) {
        const expectedFileDir = parse(expectedFile).dir;
        mkdirSync(expectedFileDir, { recursive: true });
        const actualBuffer = typeof actualFile === 'string' ? readFileSync(actualFile) : actualFile;
        writeFileSync(expectedFile, actualBuffer);
    }
    return comparePng(actualFile, expectedFile, opts);
}
