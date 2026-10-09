import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from 'vitest';

/**
 * pdf.js swallows a failed wasm load and paints CCITT, JBIG2 and JPEG 2000 images blank, so a damaged install is
 * silent below verbosity 1 (issue #278). The loader checks once per process that the decoder files exist and
 * otherwise emits PDF_TO_PNG_WASM_MISSING. Everything here uses a fake pdfjs-dist root and a mocked
 * process.emitWarning. No wasm-coded PDF is rendered in this process: pdf.js caches wasm bytes process-wide.
 */

const temporaryRoots: string[] = [];
let emitWarning: MockInstance<typeof process.emitWarning>;

beforeEach(() => {
    vi.resetModules();
    emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.doUnmock('node:module');
    vi.resetModules();
    vi.restoreAllMocks();
    for (const root of temporaryRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});

/** Creates a fake pdfjs-dist package root holding the given (empty) files in its wasm folder. */
function fakePdfjsRoot(wasmFiles: readonly string[] | undefined): string {
    const root = mkdtempSync(join(tmpdir(), 'pdfjs-fake-root-'));
    temporaryRoots.push(root);
    writeFileSync(join(root, 'package.json'), '{}');
    if (wasmFiles !== undefined) {
        mkdirSync(join(root, 'wasm'));
        for (const file of wasmFiles) {
            writeFileSync(join(root, 'wasm', file), '');
        }
    }
    return root;
}

function resolveLoaderFrom(root: string): void {
    vi.doMock('node:module', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:module')>();
        return { ...actual, default: actual, createRequire: () => ({ resolve: () => join(root, 'package.json') }) };
    });
}

function loadLoader(): Promise<typeof import('../src/pdfjsLoader.js')> {
    return import('../src/pdfjsLoader.js');
}

test('warns exactly once per process when no wasm decoder exists, with a code and the missing file names', async () => {
    const root = fakePdfjsRoot(undefined);
    resolveLoaderFrom(root);
    const { warnIfWasmDecodersMissing } = await loadLoader();

    warnIfWasmDecodersMissing();
    warnIfWasmDecodersMissing();

    expect(emitWarning).toHaveBeenCalledTimes(1);
    const [message, options] = emitWarning.mock.calls[0] as [string, { code: string }];
    expect(options).toEqual({ code: 'PDF_TO_PNG_WASM_MISSING' });
    expect(message).toContain(`${join(root, 'wasm')}: jbig2.wasm, openjpeg.wasm. `);
    expect(message).toMatch(/CCITT/);
    expect(message).toMatch(/JBIG2/);
    expect(message).toMatch(/JPEG 2000/);
});

test('names only the decoder file that is missing', async () => {
    const root = fakePdfjsRoot(['jbig2.wasm']);
    resolveLoaderFrom(root);
    const { warnIfWasmDecodersMissing } = await loadLoader();

    warnIfWasmDecodersMissing();

    expect(emitWarning).toHaveBeenCalledTimes(1);
    expect(emitWarning.mock.calls[0][0]).toContain(`${join(root, 'wasm')}: openjpeg.wasm. `);
});

test('does not warn when both decoder files exist', async () => {
    resolveLoaderFrom(fakePdfjsRoot(['jbig2.wasm', 'openjpeg.wasm']));
    const { warnIfWasmDecodersMissing } = await loadLoader();

    warnIfWasmDecodersMissing();

    expect(emitWarning).not.toHaveBeenCalled();
});

test('does not warn with the installed pdfjs-dist', async () => {
    const { warnIfWasmDecodersMissing } = await loadLoader();

    warnIfWasmDecodersMissing();
    warnIfWasmDecodersMissing();

    expect(emitWarning).not.toHaveBeenCalled();
});

test('a package lookup failure propagates and is retried, so a later call can still warn', async () => {
    const root = fakePdfjsRoot(undefined);
    const createRequire = vi.fn();
    createRequire.mockImplementationOnce(() => ({
        resolve: () => {
            throw new Error('lookup failed');
        },
    }));
    createRequire.mockImplementation(() => ({ resolve: () => join(root, 'package.json') }));
    vi.doMock('node:module', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:module')>();
        return { ...actual, default: actual, createRequire };
    });
    const { warnIfWasmDecodersMissing } = await loadLoader();

    expect(() => warnIfWasmDecodersMissing()).toThrow(/pdfjs-dist/);
    expect(emitWarning).not.toHaveBeenCalled();

    warnIfWasmDecodersMissing();

    expect(emitWarning).toHaveBeenCalledTimes(1);
});
