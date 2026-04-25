import { existsSync, promises as fsPromises, readFileSync } from 'node:fs';
import { parse } from 'node:path';
import { type ComparePngOptions, comparePngAsync } from 'png-visual-compare';

/**
 * Compares a PNG image with an expected PNG image.
 * If the expected image does not exist, it creates it by copying the actual image.
 * @param actualFile - The path or buffer of the actual PNG image.
 * @param expectedFile - The path of the expected PNG image.
 * @param opts - Optional compare options.
 * @returns A promise that resolves to the comparison result.
 */
export async function comparePNG({
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
        await fsPromises.mkdir(expectedFileDir, { recursive: true });
        const actualBuffer = typeof actualFile === 'string' ? readFileSync(actualFile) : actualFile;
        await fsPromises.writeFile(expectedFile, actualBuffer);
    }
    return await comparePngAsync(actualFile, expectedFile, opts);
}
