import { existsSync, promises as fsPromises, readFileSync } from 'node:fs';
import { parse } from 'node:path';
import { type ComparePngOptions, comparePngAsync } from 'png-visual-compare';

/**
 * Compares a PNG image with its golden (expected) PNG image.
 * A missing golden fails with an error: creating it from the image under test would compare that image with itself
 * and pass whatever the renderer produces. To create a missing golden on a developer machine, run the test with
 * UPDATE_GOLDENS=1; the actual image is copied to the golden path, so review the new file and commit it. An existing
 * golden is never overwritten. No golden is created when the CI variable has any non-empty value (GitHub Actions sets
 * CI=true), even with UPDATE_GOLDENS=1.
 * @param actualFile - The path or buffer of the actual PNG image.
 * @param expectedFile - The path of the expected (golden) PNG image.
 * @param opts - Optional compare options.
 * @returns A promise that resolves to the comparison result.
 */
export async function comparePNG({
    actualFile,
    expectedFile,
    opts,
}: {
    actualFile: string | Buffer;
    expectedFile: string;
    opts?: ComparePngOptions;
}) {
    if (!existsSync(expectedFile)) {
        if (process.env.CI) {
            throw new Error(
                `Golden PNG not found: ${expectedFile}. Goldens are never created when CI is set. Create it locally with UPDATE_GOLDENS=1 (CI unset), review the image and commit it.`,
            );
        }
        if (process.env.UPDATE_GOLDENS !== '1') {
            throw new Error(
                `Golden PNG not found: ${expectedFile}. To create it from this render, run the test again with UPDATE_GOLDENS=1, review the image and commit it.`,
            );
        }
        const expectedFileDir = parse(expectedFile).dir;
        await fsPromises.mkdir(expectedFileDir, { recursive: true });
        const actualBuffer = typeof actualFile === 'string' ? readFileSync(actualFile) : actualFile;
        await fsPromises.writeFile(expectedFile, actualBuffer);
    }
    return await comparePngAsync(actualFile, expectedFile, opts);
}
