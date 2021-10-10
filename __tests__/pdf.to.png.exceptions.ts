import { resolve } from 'path';
import { pdfToPng } from '../src';

test(`Should throw "PDF file not found" exception`, async () => {
    const pdfFilePath: string = resolve('non_existing_file.pdf');
    
    await expect(async() => { await pdfToPng(pdfFilePath) }).rejects.toThrow(Error);
});
