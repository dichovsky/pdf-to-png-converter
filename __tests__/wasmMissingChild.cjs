'use strict';

/**
 * Child process for the "pdfjs-dist has no wasm folder" test in pdf.to.png.worker.threads.test.ts.
 *
 * It must be a separate Node process: once one load has succeeded, pdf.js keeps the wasm bytes in a process-wide
 * cache, so a "missing decoder" case run after any successful render in the same process would not be missing.
 *
 * It points the compiled loader at a fake pdfjs-dist root (a package.json plus cmaps and standard_fonts, no wasm
 * folder) by wrapping `Module._resolveFilename`, which the loader's `require.resolve` goes through. The wrapper
 * overrides only `pdfjs-dist/package.json` requested by `pdfjsLoader.js` and passes every other resolution to the
 * real function. pdf.js is still imported from the real package.
 *
 * Usage: node wasmMissingChild.cjs <compiled out dir> <fake pdfjs-dist root> <result dir> <codec pdf> <control pdf>
 * Writes codec.png, codec-again.png and control.png into <result dir> and prints one JSON line on stdout with the
 * asset directory the loader resolved and every process warning the child saw.
 */

const Module = require('node:module');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const [outDirectory, fakeRoot, resultDirectory, codecPdf, controlPdf] = process.argv.slice(2);

const realResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilenameWithFakePdfjsRoot(request, parent, ...rest) {
    if (request === 'pdfjs-dist/package.json' && String(parent?.filename).endsWith('pdfjsLoader.js')) {
        return join(fakeRoot, 'package.json');
    }
    return realResolveFilename.call(this, request, parent, ...rest);
};

const warnings = [];
process.on('warning', (warning) => warnings.push({ name: warning.name, code: warning.code, message: warning.message }));

async function main() {
    const { pdfToPng } = require(join(outDirectory, 'index.js'));
    const { pdfjsAssetDirectory } = require(join(outDirectory, 'pdfjsLoader.js'));

    const wasmDirectory = pdfjsAssetDirectory('wasm');
    const [codec] = await pdfToPng(codecPdf);
    // A second conversion in the same process must not warn again.
    const [codecAgain] = await pdfToPng(codecPdf);
    const [control] = await pdfToPng(controlPdf);
    writeFileSync(join(resultDirectory, 'codec.png'), codec.content);
    writeFileSync(join(resultDirectory, 'codec-again.png'), codecAgain.content);
    writeFileSync(join(resultDirectory, 'control.png'), control.content);

    // Warnings are emitted on the next tick; let them reach the 'warning' listener before reporting.
    await new Promise((resolveTick) => setImmediate(resolveTick));
    process.stdout.write(`${JSON.stringify({ wasmDirectory, warnings })}\n`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
