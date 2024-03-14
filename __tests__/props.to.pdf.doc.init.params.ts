import { expect } from 'chai';
import { test } from 'mocha';
import { resolve } from 'node:path';
import { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import { propsToPdfDocInitParams } from '../src/props.to.pdf.doc.init.params';
import { PdfToPngOptions } from '../src/types/pdf.to.png.options';

const cMapUrl: string = resolve('./node_modules/pdfjs-dist/standard_fonts/');
const standardFontDataUrl: string = resolve('./node_modules/pdfjs-dist/cmaps/');

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
            enableXfa: false,
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
            enableXfa: false,
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
            enableXfa: false,
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
            enableXfa: false,
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
            enableXfa: false,
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
            enableXfa: false,
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
            enableXfa: false,
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
            outputFileMask: 'outputFileMask',
            pagesToProcess: [1, 2, 3],
            strictPagesToProcess: true,
            verbosityLevel: 2,
        },
        expectedPdfDocInitParams: {
            cMapUrl,
            cMapPacked: true,
            standardFontDataUrl,
            verbosity: 2,
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

        expect(actualPdfDocInitParams).to.deep.equal(testData.expectedPdfDocInitParams);
    });
}
