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
