'use strict';

/**
 * Child process for pdf.to.png.concurrent.wasm.test.ts (issue #288).
 *
 * It must be a fresh Node process: once one wasm fetch has succeeded, pdf.js keeps the bytes in a process-wide cache,
 * and the hang only happens before that.
 *
 * Usage: node concurrentWasmChild.cjs <compiled out dir> <scanned pdf> <invalid|metadata>
 * Starts two conversions at once: the scanned PDF, then either a malformed PDF or a metadata-only conversion of the
 * same file. The scanned bytes are passed in memory so its document opens first, as in the issue's repro. The second
 * conversion settles before the scanned page's first wasm decode. Prints both settled statuses as one JSON line.
 * Without the fix the scanned conversion never settles; nothing else keeps the process alive, so it exits with no output.
 */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const [outDirectory, scannedPdf, concurrent] = process.argv.slice(2);
const { pdfToPng } = require(join(outDirectory, 'index.js'));

const scanned = readFileSync(scannedPdf);
// Start order matters: the document opened last owns the handler pdf.js uses for every wasm fetch.
const scannedConversion = pdfToPng(scanned);
const other =
    concurrent === 'metadata'
        ? pdfToPng(scanned, { returnMetadataOnly: true })
        : pdfToPng(new Uint8Array(Buffer.from('%PDF-1.7\nnot a pdf\n%%EOF\n')));

Promise.allSettled([scannedConversion, other]).then((results) => {
    process.stdout.write(`${JSON.stringify(results.map((result) => result.status))}\n`);
});
