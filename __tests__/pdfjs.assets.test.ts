import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { PDFJS_ASSET_DIRECTORIES, PDFJS_WASM_DECODER_FILES } from '../src/const.js';
import { pdfjsAssetDirectory } from '../src/pdfjsLoader.js';
import { PDFJS_PACKAGE_DIRECTORIES, STANDARD_CMAPS, STANDARD_FONTS, STANDARD_WASM } from './test-data-constants.js';

const ASSET_DIRECTORIES = [
    { label: 'standard-font', directory: PDFJS_ASSET_DIRECTORIES.standardFonts, expectedFiles: STANDARD_FONTS },
    { label: 'CMap', directory: PDFJS_ASSET_DIRECTORIES.cmaps, expectedFiles: STANDARD_CMAPS },
    { label: 'WASM', directory: PDFJS_ASSET_DIRECTORIES.wasm, expectedFiles: STANDARD_WASM },
] as const;

/** The installed pdfjs-dist package root, found independently of the loader under test. */
const PDFJS_PACKAGE_ROOT = dirname(createRequire(__filename).resolve('pdfjs-dist/package.json'));

test.each(ASSET_DIRECTORIES)('pdfjs-dist ships the expected $label assets', ({ directory, expectedFiles }) => {
    const actualFiles = readdirSync(pdfjsAssetDirectory(directory)).sort();
    expect(actualFiles).toEqual([...expectedFiles].sort());
});

// Exact on purpose, not a subset check. pdf.js reads each asset folder through a location the loader must hand it
// (cMapUrl, standardFontDataUrl, wasmUrl; pdf.js also has iccUrl for `iccs`, which the loader does not pass today).
// A folder nobody reviewed is a folder nobody wired: the missing `wasmUrl` left CCITT and JBIG2 images blank without
// any error (issue #278). When pdfjs-dist adds, renames or removes a top-level folder, review what it is for, decide
// whether the loader needs a new parameter, then update PDFJS_PACKAGE_DIRECTORIES. CONTRIBUTING.md describes this
// review-gated principle: added files and folders are deliberately not accepted as a subset.
test('pdfjs-dist ships exactly the reviewed set of top-level folders', () => {
    const actualDirectories = readdirSync(PDFJS_PACKAGE_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    expect(actualDirectories).toEqual([...PDFJS_PACKAGE_DIRECTORIES].sort());
});

test('the loader resolves every asset directory inside the installed pdfjs-dist package', () => {
    for (const directory of Object.values(PDFJS_ASSET_DIRECTORIES)) {
        expect(pdfjsAssetDirectory(directory)).toBe(join(PDFJS_PACKAGE_ROOT, directory));
        expect(PDFJS_PACKAGE_DIRECTORIES).toContain(directory);
    }
});

test('every decoder file the loader checks for is part of the reviewed wasm folder', () => {
    expect(PDFJS_WASM_DECODER_FILES.length).toBeGreaterThan(0);
    for (const file of PDFJS_WASM_DECODER_FILES) {
        expect(STANDARD_WASM).toContain(file);
    }
});
