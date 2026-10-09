import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { VerbosityLevel } from '../src/types.js';

/**
 * The loader finds the installed pdfjs-dist package once, from its own location, and has no working-directory
 * fallback (issue #278): a node_modules folder in process.cwd() is not necessarily the copy pdf.js was imported
 * from, and pdf.js can import JavaScript from the asset URL it is given. These tests make that lookup fail.
 */

const resolvePackage = vi.fn<(request: string) => string>();
const createRequire = vi.fn<(from: string) => { resolve: typeof resolvePackage }>(() => ({ resolve: resolvePackage }));
const getDocument = vi.fn<() => PDFDocumentLoadingTask>();

const documentOptions = {
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: true,
    pdfFilePassword: undefined,
    verbosityLevel: VerbosityLevel.ERRORS,
};

beforeEach(() => {
    vi.resetModules();
    resolvePackage.mockReset();
    createRequire.mockClear();
    getDocument.mockReset();
    vi.doMock('node:module', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:module')>();
        return { ...actual, default: actual, createRequire };
    });
    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument }));
});

afterEach(() => {
    vi.doUnmock('node:module');
    vi.doUnmock('pdfjs-dist/legacy/build/pdf.mjs');
    vi.resetModules();
    vi.restoreAllMocks();
});

function loadLoader(): Promise<typeof import('../src/pdfjsLoader.js')> {
    return import('../src/pdfjsLoader.js');
}

function catchSync(action: () => unknown): Error {
    try {
        action();
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected the action to throw');
}

test('pdfjsAssetDirectory names pdfjs-dist, the path it searched from, and keeps the original error as the cause', async () => {
    const original = new Error("Cannot find module 'pdfjs-dist/package.json'");
    resolvePackage.mockImplementation(() => {
        throw original;
    });
    const { pdfjsAssetDirectory } = await loadLoader();

    const error = catchSync(() => pdfjsAssetDirectory('wasm'));

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('pdfjs-dist');
    const searchedFrom = createRequire.mock.calls[0][0];
    expect(searchedFrom.replaceAll('\\', '/')).toMatch(/\/src\/pdfjsLoader\.ts$/);
    expect(error.message).toContain(searchedFrom);
    expect(error.cause).toBe(original);
    expect(resolvePackage).toHaveBeenCalledWith('pdfjs-dist/package.json');
});

test('getPdfDocument rejects with the same descriptive error and never calls pdf.js', async () => {
    const original = new Error('MODULE_NOT_FOUND');
    resolvePackage.mockImplementation(() => {
        throw original;
    });
    const { getPdfDocument } = await loadLoader();

    const rejection = getPdfDocument(new Uint8Array([1]), documentOptions);

    await expect(rejection).rejects.toMatchObject({ message: expect.stringContaining('pdfjs-dist'), cause: original });
    await expect(rejection).rejects.toMatchObject({ message: expect.stringContaining(createRequire.mock.calls[0][0]) });
    expect(getDocument).not.toHaveBeenCalled();
});

test('a failed lookup is not remembered: the next call searches again and succeeds once the package is found', async () => {
    resolvePackage.mockImplementationOnce(() => {
        throw new Error('not yet installed');
    });
    const { pdfjsAssetDirectory } = await loadLoader();
    expect(() => pdfjsAssetDirectory('wasm')).toThrow(/pdfjs-dist/);

    resolvePackage.mockReturnValue(join('/fake', 'pdfjs-dist', 'package.json'));

    expect(pdfjsAssetDirectory('wasm')).toBe(join('/fake', 'pdfjs-dist', 'wasm'));
    expect(createRequire).toHaveBeenCalledTimes(2);
});

test('a found package root is remembered, so asset lookup resolves it once and stays independent of the working directory', async () => {
    const packageJson = join('/fake', 'pdfjs-dist', 'package.json');
    resolvePackage.mockReturnValue(packageJson);
    const { pdfjsAssetDirectory } = await loadLoader();
    const cwdSpy = vi.spyOn(process, 'cwd');

    expect(pdfjsAssetDirectory('cmaps')).toBe(join(dirname(packageJson), 'cmaps'));
    expect(pdfjsAssetDirectory('standard_fonts')).toBe(join(dirname(packageJson), 'standard_fonts'));
    expect(pdfjsAssetDirectory('wasm')).toBe(join(dirname(packageJson), 'wasm'));

    expect(createRequire).toHaveBeenCalledTimes(1);
    expect(resolvePackage).toHaveBeenCalledTimes(1);
    expect(cwdSpy).not.toHaveBeenCalled();
});
