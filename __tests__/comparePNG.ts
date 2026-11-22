import { existsSync, promises as fsPromises } from 'node:fs';
import { dirname, join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/**
 * Compares a PNG image with its golden (expected) PNG image.
 * A missing golden fails with an error: creating it from the image under test would compare that image with itself
 * and pass whatever the renderer produces. To create a missing golden on a developer machine, run the test with
 * UPDATE_GOLDENS=1; the actual image is copied to the golden path, so review the new file and commit it. An existing
 * golden is never overwritten. No golden is created when the CI variable has any non-empty value (GitHub Actions sets
 * CI=true), even with UPDATE_GOLDENS=1.
 * @param actualFile - The path or buffer of the actual PNG image.
 * @param expectedFile - The path of the expected (golden) PNG image.
 * @returns A promise that resolves to the comparison result.
 */
export async function comparePNG({ actualFile, expectedFile }: { actualFile: string | Buffer; expectedFile: string }) {
    const missingGolden = !existsSync(expectedFile);
    if (missingGolden) {
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
    }
    const actualBytes = typeof actualFile === 'string' ? await fsPromises.readFile(actualFile) : actualFile;
    const actual = PNG.sync.read(actualBytes);
    if (missingGolden) {
        const directory = dirname(expectedFile);
        await fsPromises.mkdir(directory, { recursive: true });
        const staging = await fsPromises.mkdtemp(join(directory, '.golden-'));
        try {
            const complete = join(staging, 'page.png');
            await fsPromises.writeFile(complete, actualBytes);
            // Publish a complete PNG in one step. A concurrent creator keeps its own golden.
            try {
                await fsPromises.link(complete, expectedFile);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            }
        } finally {
            await fsPromises.rm(staging, { recursive: true, force: true });
        }
    }
    const expected = PNG.sync.read(await fsPromises.readFile(expectedFile));
    if (actual.width !== expected.width || actual.height !== expected.height) {
        throw new Error(
            `Golden PNG dimensions differ for ${expectedFile}: expected ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}`,
        );
    }
    return pixelmatch(actual.data, expected.data, undefined, actual.width, actual.height);
}
