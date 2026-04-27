import { promises as fsPromises } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { pdfToPng } from '../src';

test('should narrow file outputs by kind without type assertions', async () => {
    const outputFolder = resolve('./test-results/png.page.output.kind');
    await fsPromises.rm(outputFolder, { recursive: true, force: true });

    const [page] = await pdfToPng(resolve('./test-data/sample.pdf'), {
        outputFolder,
        pagesToProcess: [1],
        returnPageContent: false,
    });

    expect(page.kind).toBe('file');
    if (page.kind === 'file') {
        expect(page.path).toContain('sample_page_1.png');
        expect(page.content).toBeUndefined();
    }
});
