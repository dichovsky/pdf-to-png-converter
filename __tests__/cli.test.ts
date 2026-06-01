import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import fs from 'node:fs';
import * as cli from '../src/cli.js';
import { buildPdfToPngOptions, executeConversion, getVersion, HELP_TEXT, parseBoolean, parseNumberList, run } from '../src/cli.js';
import { pdfToPngCore } from '../src/pdfToPngCore.js';
import { normalizePdfToPngOptions } from '../src/normalizePdfToPngOptions.js';

vi.mock('../src/pdfToPngCore.js', () => ({
    pdfToPngCore: vi.fn().mockResolvedValue([]),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helper to set process.argv for each test
// ─────────────────────────────────────────────────────────────────────────────

function setArgv(...args: string[]): void {
    process.argv = ['node', 'cli.js', ...args];
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for pure helper functions
// ─────────────────────────────────────────────────────────────────────────────

describe('parseBoolean', () => {
    it('returns undefined for undefined input', () => {
        expect(parseBoolean(undefined)).toBeUndefined();
    });

    it('returns true for "true"', () => {
        expect(parseBoolean('true')).toBe(true);
    });

    it('returns true for "1"', () => {
        expect(parseBoolean('1')).toBe(true);
    });

    it('returns false for "false"', () => {
        expect(parseBoolean('false')).toBe(false);
    });

    it('returns false for "0"', () => {
        expect(parseBoolean('0')).toBe(false);
    });

    it('throws on an unrecognised value', () => {
        expect(() => parseBoolean('maybe')).toThrow('Invalid boolean value: "maybe"');
    });
});

describe('parseNumberList', () => {
    it('returns undefined for undefined input', () => {
        expect(parseNumberList(undefined)).toBeUndefined();
    });

    it('parses a comma-separated list of integers', () => {
        expect(parseNumberList('1,2,3')).toEqual([1, 2, 3]);
    });

    it('trims whitespace around tokens', () => {
        expect(parseNumberList(' 4 , 5 , 6 ')).toEqual([4, 5, 6]);
    });

    it('throws when a token is not a valid integer', () => {
        expect(() => parseNumberList('1,abc,3')).toThrow('Invalid integer in list: "abc"');
    });

    it('throws when a token is a float (not an integer)', () => {
        expect(() => parseNumberList('1,1.5,3')).toThrow('Invalid integer in list: "1.5"');
    });

    it('throws when a token is empty', () => {
        expect(() => parseNumberList('1,,3')).toThrow('Invalid integer in list: empty value.');
    });
});

describe('buildPdfToPngOptions', () => {
    it('returns the pdf path and a fully-normalized options object', () => {
        const built = buildPdfToPngOptions(
            {
                'output-folder': '/out',
                'viewport-scale': '2',
                'use-system-fonts': true,
                'disable-font-face': 'false',
                'enable-xfa': 'true',
                'pages-to-process': '1,2,3',
                'verbosity-level': '1',
                'process-pages-in-parallel': true,
                'concurrency-limit': '2',
            },
            ['test.pdf'],
        );

        expect(built.pdfFilePath).toBe('test.pdf');
        // Returned options shape is NormalizedPdfToPngOptions — produced by a single
        // call to normalizePdfToPngOptions inside buildPdfToPngOptions (ARCH-011).
        expect(built.options).toEqual(
            normalizePdfToPngOptions({
                outputFolder: '/out',
                viewportScale: 2,
                useSystemFonts: true,
                disableFontFace: false,
                enableXfa: true,
                pdfFilePassword: undefined,
                pagesToProcess: [1, 2, 3],
                verbosityLevel: 1,
                processPagesInParallel: true,
                concurrencyLimit: 2,
                returnMetadataOnly: undefined,
                returnPageContent: false,
            }),
        );
    });

    it('throws when no pdf path is provided', () => {
        expect(() => buildPdfToPngOptions({}, [])).toThrow('<pdf-file-path> is required.');
    });

    it('throws when image conversion is requested without --output-folder', () => {
        expect(() => buildPdfToPngOptions({}, ['test.pdf'])).toThrow(
            'The CLI requires --output-folder for image conversion. Use --return-metadata-only for stdout-friendly page metadata.',
        );
    });

    it('throws when --return-page-content is used in the CLI', () => {
        expect(() => buildPdfToPngOptions({ 'output-folder': '/out', 'return-page-content': true }, ['test.pdf'])).toThrow(
            '--return-page-content is not supported by the CLI. Use the library API if you need in-memory PNG buffers.',
        );
    });

    it('throws when --verbosity-level is provided as an empty string', () => {
        expect(() => buildPdfToPngOptions({ 'verbosity-level': '', 'return-metadata-only': true }, ['test.pdf'])).toThrow(
            '--verbosity-level must be a valid integer.',
        );
    });

    it('throws when --viewport-scale is provided as an empty string', () => {
        expect(() => buildPdfToPngOptions({ 'viewport-scale': '', 'return-metadata-only': true }, ['test.pdf'])).toThrow(
            '--viewport-scale must be a valid number.',
        );
    });
});

describe('executeConversion', () => {
    it('logs success output without using process.exit', async () => {
        const log = vi.fn();

        await executeConversion('test.pdf', normalizePdfToPngOptions({ outputFolder: '/out' }), log);

        expect(log).toHaveBeenCalledWith('Successfully processed 0 page(s).');
    });

    it('writes metadata JSON without an informational banner', async () => {
        vi.mocked(pdfToPngCore).mockResolvedValueOnce([
            { kind: 'metadata', pageNumber: 1, name: 'page_1.png', width: 595, height: 842, rotation: 0, content: undefined, path: '' },
        ]);
        const logInfo = vi.fn();
        const writeOutput = vi.fn();

        await executeConversion('test.pdf', normalizePdfToPngOptions({ returnMetadataOnly: true }), logInfo, writeOutput);

        expect(logInfo).not.toHaveBeenCalled();
        expect(writeOutput).toHaveBeenCalledWith(expect.stringContaining('"pageNumber": 1'));
    });
});

describe('getVersion', () => {
    it('throws when package.json cannot be read', () => {
        vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
            throw new Error('ENOENT');
        });

        expect(() => getVersion()).toThrow('Cannot determine package version: package.json missing or malformed');
    });

    it('throws when package.json has no version field', () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('{}');

        expect(() => getVersion()).toThrow('Cannot determine package version: package.json missing or malformed');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLI integration tests
// ─────────────────────────────────────────────────────────────────────────────

describe('CLI run()', () => {
    let exitSpy: MockInstance;
    let logSpy: MockInstance;
    let errorSpy: MockInstance;
    let originalArgv: string[];

    beforeEach(() => {
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        originalArgv = process.argv;
        vi.clearAllMocks();
    });

    afterEach(() => {
        process.argv = originalArgv;
        vi.restoreAllMocks();
    });

    // ── --help ────────────────────────────────────────────────────────────────

    it('prints help text and exits 0 when --help is passed', async () => {
        setArgv('--help');
        await run();
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: pdf-to-png-converter'));
        expect(exitSpy).toHaveBeenCalledWith(0);
        expect(exitSpy).toHaveBeenCalledTimes(1);
        // Execution must stop after --help; the core must never be called
        expect(pdfToPngCore).not.toHaveBeenCalled();
    });

    // ── --version ─────────────────────────────────────────────────────────────

    it('prints the version and exits 0 when --version is passed', async () => {
        setArgv('--version');
        await run();
        expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^v\d+\.\d+\.\d+/));
        expect(exitSpy).toHaveBeenCalledWith(0);
        expect(exitSpy).toHaveBeenCalledTimes(1);
        expect(pdfToPngCore).not.toHaveBeenCalled();
    });

    it('prints an error and exits 1 when package.json cannot be read for --version', async () => {
        vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
            throw new Error('ENOENT');
        });
        setArgv('--version');
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Cannot determine package version: package.json missing or malformed');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('prints an error and exits 1 when package.json has no version field for --version', async () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('{}');
        setArgv('--version');
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Cannot determine package version: package.json missing or malformed');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    // ── Parse errors ──────────────────────────────────────────────────────────

    it('exits 1 on an unrecognised flag', async () => {
        setArgv('--unknown-flag');
        await run();
        expect(errorSpy).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(HELP_TEXT));
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPngCore).not.toHaveBeenCalled();
    });

    // ── Required argument validation ──────────────────────────────────────────

    it('exits 1 when no pdf path is provided', async () => {
        setArgv();
        await run();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('<pdf-file-path> is required'));
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(exitSpy).toHaveBeenCalledTimes(1);
    });

    // ── Numeric option validation ──────────────────────────────────────────────

    it('exits 1 when --viewport-scale is not a valid number', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--viewport-scale', 'abc');
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Error: --viewport-scale must be a valid number.');
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPngCore).not.toHaveBeenCalled();
    });

    it('exits 1 when --viewport-scale is a partially-valid string (e.g. "2x")', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--viewport-scale', '2x');
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Error: --viewport-scale must be a valid number.');
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPngCore).not.toHaveBeenCalled();
    });

    it('exits 1 when --verbosity-level is not a valid integer', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--verbosity-level', 'abc');
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Error: --verbosity-level must be a valid integer.');
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPngCore).not.toHaveBeenCalled();
    });

    it('exits 1 when --verbosity-level is a partially-valid string (e.g. "1x")', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--verbosity-level', '1x');
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Error: --verbosity-level must be a valid integer.');
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPngCore).not.toHaveBeenCalled();
    });

    it('exits 1 when --verbosity-level is a float (e.g. "1.5")', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--verbosity-level', '1.5');
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Error: --verbosity-level must be a valid integer.');
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPngCore).not.toHaveBeenCalled();
    });

    it('exits 1 when --concurrency-limit is not a valid integer', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--concurrency-limit', 'abc');
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Error: --concurrency-limit must be a valid integer.');
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPngCore).not.toHaveBeenCalled();
    });

    it('exits 1 when --concurrency-limit is a float (e.g. "2.5")', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--concurrency-limit', '2.5');
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Error: --concurrency-limit must be a valid integer.');
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPngCore).not.toHaveBeenCalled();
    });

    it('exits 1 when --concurrency-limit is a partially-valid string (e.g. "2x")', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--concurrency-limit', '2x');
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Error: --concurrency-limit must be a valid integer.');
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPngCore).not.toHaveBeenCalled();
    });

    // ── Boolean / list option validation ─────────────────────────────────────

    it('exits 1 when --disable-font-face has an invalid value', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--disable-font-face', 'maybe');
        await run();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid boolean value: "maybe"'));
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPngCore).not.toHaveBeenCalled();
    });

    it('exits 1 when --enable-xfa has an invalid value', async () => {
        // --disable-font-face must be valid so execution reaches the --enable-xfa check
        setArgv('test.pdf', '--output-folder', '/out', '--disable-font-face', 'true', '--enable-xfa', 'bad');
        await run();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid boolean value: "bad"'));
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPngCore).not.toHaveBeenCalled();
    });

    it('exits 1 when --pages-to-process contains an invalid integer', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--pages-to-process', '1,abc,3');
        await run();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid integer in list: "abc"'));
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPngCore).not.toHaveBeenCalled();
    });

    // ── Successful invocation ─────────────────────────────────────────────────

    it('calls pdfToPngCore with a fully-normalized options object', async () => {
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
            '--pages-to-process',
            '1,2,3',
            '--verbosity-level',
            '1',
            '--process-pages-in-parallel',
            '--concurrency-limit',
            '2',
        );

        await run();

        expect(pdfToPngCore).toHaveBeenCalledTimes(1);
        expect(pdfToPngCore).toHaveBeenCalledWith(
            'test.pdf',
            normalizePdfToPngOptions({
                outputFolder: '/out',
                viewportScale: 2,
                useSystemFonts: true,
                disableFontFace: false,
                enableXfa: true,
                pdfFilePassword: undefined,
                pagesToProcess: [1, 2, 3],
                verbosityLevel: 1,
                processPagesInParallel: true,
                concurrencyLimit: 2,
                returnMetadataOnly: undefined,
                returnPageContent: false,
            }),
        );
        expect(logSpy).toHaveBeenCalledWith('Processing PDF: test.pdf');
        expect(logSpy).toHaveBeenCalledWith('Output folder: /out');
        expect(logSpy).toHaveBeenCalledWith('Successfully processed 0 page(s).');
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('passes --pdf-file-password and boolean flags using 1/0 notation', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--pdf-file-password', 'secret', '--disable-font-face', '0', '--enable-xfa', '1');

        await run();

        expect(pdfToPngCore).toHaveBeenCalledWith(
            'test.pdf',
            expect.objectContaining({
                pdfFilePassword: 'secret',
                disableFontFace: false,
                enableXfa: true,
            }),
        );
    });

    it('rejects --return-page-content because the CLI has no observable buffer output mode', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--return-page-content');
        await run();
        expect(errorSpy).toHaveBeenCalledWith(
            'Error: --return-page-content is not supported by the CLI. Use the library API if you need in-memory PNG buffers.',
        );
        expect(pdfToPngCore).not.toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('rejects image conversion without --output-folder', async () => {
        setArgv('test.pdf');
        await run();
        expect(errorSpy).toHaveBeenCalledWith(
            'Error: The CLI requires --output-folder for image conversion. Use --return-metadata-only for stdout-friendly page metadata.',
        );
        expect(pdfToPngCore).not.toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('does not log processing info in --silent mode', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--silent');
        await run();
        expect(pdfToPngCore).toHaveBeenCalledTimes(1);
        expect(logSpy).not.toHaveBeenCalled();
    });

    // ── --return-metadata-only ─────────────────────────────────────────────────

    it('accepts --return-metadata-only without --output-folder', async () => {
        vi.mocked(pdfToPngCore).mockResolvedValueOnce([
            { kind: 'metadata', pageNumber: 1, name: 'page_1.png', width: 595, height: 842, rotation: 0, content: undefined, path: '' },
        ]);

        setArgv('test.pdf', '--return-metadata-only');
        await run();

        expect(pdfToPngCore).toHaveBeenCalledTimes(1);
        expect(pdfToPngCore).toHaveBeenCalledWith(
            'test.pdf',
            expect.objectContaining({ returnMetadataOnly: true, outputFolder: undefined }),
        );
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"pageNumber": 1'));
        expect(logSpy).not.toHaveBeenCalledWith('Processing PDF: test.pdf');
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('prints metadata JSON in --silent --return-metadata-only mode', async () => {
        vi.mocked(pdfToPngCore).mockResolvedValueOnce([
            { kind: 'metadata', pageNumber: 1, name: 'page_1.png', width: 595, height: 842, rotation: 0, content: undefined, path: '' },
        ]);

        setArgv('test.pdf', '--return-metadata-only', '--silent');
        await run();
        expect(pdfToPngCore).toHaveBeenCalledTimes(1);
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"pageNumber": 1'));
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('does not log output-folder chatter in metadata-only mode because no files are written', async () => {
        vi.mocked(pdfToPngCore).mockResolvedValueOnce([
            { kind: 'metadata', pageNumber: 1, name: 'page_1.png', width: 595, height: 842, rotation: 0, content: undefined, path: '' },
        ]);

        setArgv('test.pdf', '--return-metadata-only', '--output-folder', '/out');
        await run();

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"pageNumber": 1'));
        expect(logSpy).not.toHaveBeenCalledWith('Processing PDF: test.pdf');
        expect(logSpy).not.toHaveBeenCalledWith('Output folder: /out');
        expect(exitSpy).not.toHaveBeenCalled();
    });

    // ── Error from pdfToPngCore ───────────────────────────────────────────────

    it('exits 1 and prints the error when pdfToPngCore throws', async () => {
        vi.mocked(pdfToPngCore).mockRejectedValueOnce(new Error('render failed'));

        setArgv('test.pdf', '--output-folder', '/out');
        await run();

        expect(errorSpy).toHaveBeenCalledWith('Error:');
        expect(errorSpy).toHaveBeenCalledWith('render failed');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('handles non-Error rejections from pdfToPngCore', async () => {
        vi.mocked(pdfToPngCore).mockRejectedValueOnce('string error');

        setArgv('test.pdf', '--output-folder', '/out');
        await run();

        expect(errorSpy).toHaveBeenCalledWith('string error');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Verify the exported surface is correct
// ─────────────────────────────────────────────────────────────────────────────

describe('module exports', () => {
    it('exports run, HELP_TEXT, parseBoolean, parseNumberList, buildPdfToPngOptions, and executeConversion', () => {
        expect(typeof cli.run).toBe('function');
        expect(typeof cli.HELP_TEXT).toBe('string');
        expect(typeof cli.parseBoolean).toBe('function');
        expect(typeof cli.parseNumberList).toBe('function');
        expect(typeof cli.buildPdfToPngOptions).toBe('function');
        expect(typeof cli.executeConversion).toBe('function');
        expect(typeof cli.getVersion).toBe('function');
    });
});
