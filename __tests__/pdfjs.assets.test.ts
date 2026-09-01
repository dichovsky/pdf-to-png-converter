import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { CMAP_RELATIVE_URL, STANDARD_FONTS_RELATIVE_URL } from '../src/const.js';
import { STANDARD_CMAPS, STANDARD_FONTS } from './test-data-constants.js';

const ASSET_DIRECTORIES = [
    { label: 'standard-font', relativePath: STANDARD_FONTS_RELATIVE_URL, expectedFiles: STANDARD_FONTS },
    { label: 'CMap', relativePath: CMAP_RELATIVE_URL, expectedFiles: STANDARD_CMAPS },
] as const;

test.each(ASSET_DIRECTORIES)('pdfjs-dist ships the expected $label assets', ({ relativePath, expectedFiles }) => {
    const actualFiles = readdirSync(resolve(relativePath)).sort();
    expect(actualFiles).toEqual([...expectedFiles].sort());
});
