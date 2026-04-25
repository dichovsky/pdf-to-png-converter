import { readdirSync } from 'node:fs';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import { expect, test } from 'vitest';
import { CMAP_RELATIVE_URL, STANDARD_FONTS_RELATIVE_URL } from '../src/const';
import { STANDARD_CMAPS, STANDARD_FONTS } from './test-data-constants';
import { propsToPdfDocInitParams } from '../src/propsToPdfDocInitParams';
import type { PdfToPngOptions } from '../src/interfaces/pdf.to.png.options.js';
import { normalizePath } from '../src/normalizePath.js';

// Resolved at test-run time so the expected values match what propsToPdfDocInitParams() returns
// (which also resolves at call time). This avoids the module-load-time lock-in of the old approach.
const cMapUrl: string = normalizePath(CMAP_RELATIVE_URL);
const standardFontDataUrl: string = normalizePath(STANDARD_FONTS_RELATIVE_URL);

const testDataArray: { id: string; props?: PdfToPngOptions; expectedPdfDocInitParams: DocumentInitParameters }[] = [
    {
        id: 'props undefined',
        expectedPdfDocInitParams: {
            cMapUrl,
            cMapPacked: true,
            standardFontDataUrl,
            verbosity: 0,
            disableFontFace: true,
            useSystemFonts: false,
            enableXfa: true,
            password: undefined,
        },
    },
    {
        id: 'props are empty',
        props: {},
        expectedPdfDocInitParams: {
            cMapUrl,
            cMapPacked: true,
            standardFontDataUrl,
            verbosity: 0,
            disableFontFace: true,
            useSystemFonts: false,
            enableXfa: true,
            password: undefined,
        },
    },
    {
        id: 'only viewportScale is specified',
        props: {
            viewportScale: 15,
        },
        expectedPdfDocInitParams: {
            cMapUrl,
            cMapPacked: true,
            standardFontDataUrl,
            verbosity: 0,
            disableFontFace: true,
            useSystemFonts: false,
            enableXfa: true,
            password: undefined,
        },
    },
    {
        id: 'only disableFontFace is specified',
        props: {
            disableFontFace: false,
        },
        expectedPdfDocInitParams: {
            cMapUrl,
            cMapPacked: true,
            standardFontDataUrl,
            verbosity: 0,
            disableFontFace: false,
            useSystemFonts: false,
            enableXfa: true,
            password: undefined,
        },
    },
    {
        id: 'only useSystemFonts is specified',
        props: {
            useSystemFonts: true,
        },
        expectedPdfDocInitParams: {
            cMapUrl,
            cMapPacked: true,
            standardFontDataUrl,
            verbosity: 0,
            disableFontFace: true,
            useSystemFonts: true,
            enableXfa: true,
            password: undefined,
        },
    },
    {
        id: 'only pdfFilePassword is specified',
        props: {
            pdfFilePassword: '12345',
        },
        expectedPdfDocInitParams: {
            cMapUrl,
            cMapPacked: true,
            standardFontDataUrl,
            verbosity: 0,
            disableFontFace: true,
            useSystemFonts: false,
            enableXfa: true,
            password: '12345',
        },
    },
    {
        id: 'only verbosityLevel is specified',
        props: {
            verbosityLevel: 1,
        },
        expectedPdfDocInitParams: {
            cMapUrl,
            cMapPacked: true,
            standardFontDataUrl,
            verbosity: 1,
            disableFontFace: true,
            useSystemFonts: false,
            enableXfa: true,
            password: undefined,
        },
    },
    {
        id: 'only enableXfa is specified',
        props: {
            enableXfa: true,
        },
        expectedPdfDocInitParams: {
            cMapUrl,
            cMapPacked: true,
            standardFontDataUrl,
            verbosity: 0,
            disableFontFace: true,
            useSystemFonts: false,
            enableXfa: true,
            password: undefined,
        },
    },
    {
        id: 'all props are specified',
        props: {
            viewportScale: 3.0,
            disableFontFace: false,
            useSystemFonts: true,
            enableXfa: true,
            pdfFilePassword: 'pdfFilePassword',
            outputFolder: 'outputFolder',
            pagesToProcess: [1, 2, 3],
            verbosityLevel: 5,
        },
        expectedPdfDocInitParams: {
            cMapUrl,
            cMapPacked: true,
            standardFontDataUrl,
            verbosity: 5,
            disableFontFace: false,
            useSystemFonts: true,
            enableXfa: true,
            password: 'pdfFilePassword',
        },
    },
];

for (const testData of testDataArray) {
    test(`should convert props to PdfDocInitParams when ${testData.id}`, async () => {
        const actualPdfDocInitParams: DocumentInitParameters = propsToPdfDocInitParams(testData.props);

        expect(actualPdfDocInitParams).toEqual(testData.expectedPdfDocInitParams);

        const standardFonts = readdirSync(actualPdfDocInitParams.standardFontDataUrl as string, { recursive: true });
        standardFonts.sort();
        STANDARD_FONTS.sort();
        expect(standardFonts).toEqual(STANDARD_FONTS);

        const cMap = readdirSync(actualPdfDocInitParams.cMapUrl as string, { recursive: true });
        cMap.sort();
        STANDARD_CMAPS.sort();
        expect(cMap).toEqual(STANDARD_CMAPS);
    });
}
