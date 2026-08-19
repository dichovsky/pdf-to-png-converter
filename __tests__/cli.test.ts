import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { HELP_TEXT, getVersion, run } from '../src/cli.js';
import { pdfToPng } from '../src/pdfToPng.js';

vi.mock('../src/pdfToPng.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/pdfToPng.js')>();
    return { ...actual, pdfToPng: vi.fn().mockResolvedValue([]) };
});

function setArgv(...args: string[]): void {
    process.argv = ['node', 'cli.js', ...args];
}

describe('CLI', () => {
    let exitSpy: MockInstance;
    let logSpy: MockInstance;
    let errorSpy: MockInstance;
    let originalArgv: string[];

    beforeEach(() => {
        originalArgv = process.argv;
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(pdfToPng).mockReset().mockResolvedValue([]);
    });

    afterEach(() => {
        process.argv = originalArgv;
        vi.restoreAllMocks();
    });

    it('prints help and does not invoke conversion', async () => {
        setArgv('--help');
        await run();
        expect(logSpy).toHaveBeenCalledWith(HELP_TEXT);
        expect(exitSpy).toHaveBeenCalledWith(0);
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    it('prints the package version', async () => {
        setArgv('--version');
        await run();
        expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^v\d+\.\d+\.\d+/));
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('reports a package-version lookup failure through the CLI', async () => {
        vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
            throw new Error('ENOENT');
        });
        setArgv('--version');
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Cannot determine package version: package.json missing or malformed');
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    it('normalizes version read failures to a stable error', () => {
        vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
            throw new Error('ENOENT');
        });
        expect(() => getVersion()).toThrow('Cannot determine package version: package.json missing or malformed');
    });

    it('requires a positional PDF path', async () => {
        setArgv();
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Error: <pdf-file-path> is required.');
        expect(errorSpy).toHaveBeenCalledWith(HELP_TEXT);
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    it('requires output folder except in metadata mode', async () => {
        setArgv('test.pdf');
        await run();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('CLI requires --output-folder'));
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    it('prints help and rejects an unknown option before conversion', async () => {
        setArgv('test.pdf', '--unknown-option');
        await run();
        expect(errorSpy).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(HELP_TEXT);
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    it.each([
        [['test.pdf', '--output-folder', '/out', '--viewport-scale', 'abc'], '--viewport-scale must be a valid number.'],
        [['test.pdf', '--output-folder', '/out', '--verbosity-level', '1.5'], '--verbosity-level must be a valid integer.'],
        [['test.pdf', '--output-folder', '/out', '--concurrency-limit', '2x'], '--concurrency-limit must be a valid integer.'],
        [['test.pdf', '--output-folder', '/out', '--disable-font-face', 'maybe'], 'Invalid boolean value: "maybe"'],
        [['test.pdf', '--output-folder', '/out', '--pages-to-process', '1,,3'], 'Invalid integer in list: empty value.'],
        [['test.pdf', '--output-folder', '/out', '--pages-to-process', '1,nope,3'], 'Invalid integer in list: "nope".'],
    ])('reports lexical option errors before conversion', async (args, message) => {
        setArgv(...args);
        await run();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(message));
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    it('passes raw typed options to the public conversion interface exactly once', async () => {
        setArgv(
            'test.pdf',
            '--output-folder',
            '/out',
            '--viewport-scale',
            '2',
            '--use-system-fonts',
            '--disable-font-face',
            'false',
            '--enable-xfa',
            'true',
            '--pdf-file-password',
            'secret',
            '--pages-to-process',
            '1,2',
            '--verbosity-level',
            '1',
            '--process-pages-in-parallel',
            '--concurrency-limit',
            '2',
            '--render-in-worker-threads',
        );
        await run();

        expect(pdfToPng).toHaveBeenCalledTimes(1);
        expect(pdfToPng).toHaveBeenCalledWith('test.pdf', {
            outputFolder: '/out',
            viewportScale: 2,
            useSystemFonts: true,
            disableFontFace: false,
            enableXfa: true,
            pdfFilePassword: 'secret',
            pagesToProcess: [1, 2],
            verbosityLevel: 1,
            returnMetadataOnly: undefined,
            returnPageContent: false,
            processPagesInParallel: true,
            concurrencyLimit: 2,
            renderInWorkerThreads: true,
        });
        expect(logSpy).toHaveBeenCalledWith('Successfully processed 0 page(s).');
    });

    it('prints file progress before starting conversion', async () => {
        setArgv('test.pdf', '--output-folder', '/out');
        await run();

        expect(logSpy.mock.calls.slice(0, 2)).toEqual([['Processing PDF: test.pdf'], ['Output folder: /out']]);
        expect(logSpy.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(pdfToPng).mock.invocationCallOrder[0]);
        expect(logSpy.mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(pdfToPng).mock.invocationCallOrder[0]);
    });

    it('prints metadata JSON even in silent mode', async () => {
        vi.mocked(pdfToPng).mockResolvedValueOnce([
            { kind: 'metadata', pageNumber: 1, name: 'page.png', path: '', content: undefined, width: 10, height: 20, rotation: 0 },
        ]);
        setArgv('test.pdf', '--return-metadata-only', '--silent');
        await run();
        expect(pdfToPng).toHaveBeenCalledWith('test.pdf', expect.objectContaining({ returnMetadataOnly: true }));
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"pageNumber": 1'));
    });

    it('suppresses progress and success chatter in silent file mode', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--silent');
        await run();
        expect(pdfToPng).toHaveBeenCalledTimes(1);
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('prints public conversion errors and exits 1', async () => {
        vi.mocked(pdfToPng).mockRejectedValueOnce(new Error('render failed'));
        setArgv('test.pdf', '--output-folder', '/out');
        await run();
        expect(logSpy).toHaveBeenCalledWith('Processing PDF: test.pdf');
        expect(logSpy).toHaveBeenCalledWith('Output folder: /out');
        expect(errorSpy).toHaveBeenCalledWith('Error:');
        expect(errorSpy).toHaveBeenCalledWith('render failed');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('reports semantic validation before CLI policy or progress output', async () => {
        setArgv('test.pdf', '--viewport-scale', '0');
        await run();
        expect(logSpy).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('viewportScale must be a finite number greater than 0'));
        expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('CLI requires --output-folder'));
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    it('prints non-Error conversion rejections with the same conversion-error shape', async () => {
        vi.mocked(pdfToPng).mockRejectedValueOnce('render failed');
        setArgv('test.pdf', '--output-folder', '/out');
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Error:');
        expect(errorSpy).toHaveBeenCalledWith('render failed');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('rejects the CLI-only return-page-content flag', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--return-page-content');
        await run();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--return-page-content is not supported'));
        expect(pdfToPng).not.toHaveBeenCalled();
    });
});
