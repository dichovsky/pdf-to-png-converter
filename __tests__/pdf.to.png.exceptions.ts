import { resolve } from 'path';
import { pdfToPng } from '../src';
import {readFileSync} from "fs";

test(`Should throw "PDF file not found" exception`, async () => {
    const pdfFilePath: string = resolve('non_existing_file.pdf');
    
    await expect(async() => { await pdfToPng(pdfFilePath) }).rejects.toThrow(Error);
});

test(`Should throw "outputFileMask is required when input is a Buffer" exception`, async () => {
    const pdfFileBuffer: Buffer = readFileSync(resolve('test-data/large_pdf.pdf'));

    await expect(async() => { await pdfToPng(pdfFileBuffer) }).rejects.toThrow(Error);
});

test(`Should throw error when page index < 1 is requested`, async () => {
    const pdfFilePath: string = resolve('test-data/large_pdf.pdf');

    await expect(async() => { await pdfToPng(pdfFilePath, { pages: [0, 1, 2]}) }).rejects.toThrow('Invalid pages requested');
    await expect(async() => { await pdfToPng(pdfFilePath, { pages: [1, 2, -1]}) }).rejects.toThrow('Invalid pages requested');
});
