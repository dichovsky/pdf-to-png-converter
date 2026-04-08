import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import * as cli from '../src/cli.js';
import { HELP_TEXT, parseBoolean, parseNumberList, run } from '../src/cli.js';
import { pdfToPng } from '../src/pdfToPng.js';

vi.mock('../src/pdfToPng.js', () => ({
    pdfToPng: vi.fn().mockResolvedValue([]),
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
});

// ─────────────────────────────────────────────────────────────────────────────
// CLI integration tests
// ─────────────────────────────────────────────────────────────────────────────

describe('CLI run()', () => {
    let exitSpy: ReturnType<typeof vi.spyOn<typeof process, 'exit'>>;
    let logSpy: ReturnType<typeof vi.spyOn<typeof console, 'log'>>;
    let errorSpy: ReturnType<typeof vi.spyOn<typeof console, 'error'>>;
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
        // Execution must stop after --help; pdfToPng should never be called
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    // ── --version ─────────────────────────────────────────────────────────────

    it('prints the version and exits 0 when --version is passed', async () => {
        setArgv('--version');
        await run();
        expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^v\d+\.\d+\.\d+/));
        expect(exitSpy).toHaveBeenCalledWith(0);
        expect(exitSpy).toHaveBeenCalledTimes(1);
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    it('prints "vUnknown" when package.json cannot be read', async () => {
        vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
            throw new Error('ENOENT');
        });
        setArgv('--version');
        await run();
        expect(logSpy).toHaveBeenCalledWith('vUnknown');
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('prints "vUnknown" when package.json has no version field', async () => {
        vi.spyOn(fs, 'readFileSync').mockReturnValue('{}');
        setArgv('--version');
        await run();
        expect(logSpy).toHaveBeenCalledWith('vUnknown');
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    // ── Parse errors ──────────────────────────────────────────────────────────

    it('exits 1 on an unrecognised flag', async () => {
        setArgv('--unknown-flag');
        await run();
        expect(errorSpy).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(HELP_TEXT));
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    // ── Required argument validation ──────────────────────────────────────────

    it('exits 1 when no pdf path is provided', async () => {
        setArgv();
        await run();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('<pdf-file-path> is required'));
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(exitSpy).toHaveBeenCalledTimes(1);
    });

    it('exits 1 when --output-folder is missing and --return-metadata-only is not set', async () => {
        setArgv('test.pdf');
        await run();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--output-folder is required'));
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(exitSpy).toHaveBeenCalledTimes(1);
    });

    // ── Numeric option validation ──────────────────────────────────────────────

    it('exits 1 when --viewport-scale is not a valid number', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--viewport-scale', 'abc');
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Error: --viewport-scale must be a valid number.');
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    it('exits 1 when --verbosity-level is not a valid integer', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--verbosity-level', 'abc');
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Error: --verbosity-level must be a valid integer.');
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    it('exits 1 when --concurrency-limit is not a valid integer', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--concurrency-limit', 'abc');
        await run();
        expect(errorSpy).toHaveBeenCalledWith('Error: --concurrency-limit must be a valid integer.');
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    // ── Boolean / list option validation ─────────────────────────────────────

    it('exits 1 when --disable-font-face has an invalid value', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--disable-font-face', 'maybe');
        await run();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid boolean value: "maybe"'));
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    it('exits 1 when --enable-xfa has an invalid value', async () => {
        // --disable-font-face must be valid so execution reaches the --enable-xfa check
        setArgv('test.pdf', '--output-folder', '/out', '--disable-font-face', 'true', '--enable-xfa', 'bad');
        await run();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid boolean value: "bad"'));
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    it('exits 1 when --pages-to-process contains an invalid integer', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--pages-to-process', '1,abc,3');
        await run();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid integer in list: "abc"'));
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(pdfToPng).not.toHaveBeenCalled();
    });

    // ── Successful invocation ─────────────────────────────────────────────────

    it('calls pdfToPng with all parsed options', async () => {
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

        expect(pdfToPng).toHaveBeenCalledTimes(1);
        expect(pdfToPng).toHaveBeenCalledWith('test.pdf', {
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
        });
        expect(logSpy).toHaveBeenCalledWith('Processing PDF: test.pdf');
        expect(logSpy).toHaveBeenCalledWith('Output folder: /out');
        expect(logSpy).toHaveBeenCalledWith('Successfully processed 0 page(s).');
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('passes --pdf-file-password and boolean flags using 1/0 notation', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--pdf-file-password', 'secret', '--disable-font-face', '0', '--enable-xfa', '1');

        await run();

        expect(pdfToPng).toHaveBeenCalledWith(
            'test.pdf',
            expect.objectContaining({
                pdfFilePassword: 'secret',
                disableFontFace: false,
                enableXfa: true,
            }),
        );
    });

    it('does not log processing info in --silent mode', async () => {
        setArgv('test.pdf', '--output-folder', '/out', '--silent');
        await run();
        expect(pdfToPng).toHaveBeenCalledTimes(1);
        expect(logSpy).not.toHaveBeenCalled();
    });

    // ── --return-metadata-only ─────────────────────────────────────────────────

    it('accepts --return-metadata-only without --output-folder', async () => {
        vi.mocked(pdfToPng).mockResolvedValueOnce([{ pageNumber: 1, name: 'page_1.png', width: 595, height: 842, rotation: 0, path: '' }]);

        setArgv('test.pdf', '--return-metadata-only');
        await run();

        expect(pdfToPng).toHaveBeenCalledTimes(1);
        expect(pdfToPng).toHaveBeenCalledWith('test.pdf', expect.objectContaining({ returnMetadataOnly: true, outputFolder: undefined }));
        expect(logSpy).toHaveBeenCalledWith('Metadata extraction complete:');
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"pageNumber": 1'));
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('suppresses metadata output in --silent --return-metadata-only mode', async () => {
        setArgv('test.pdf', '--return-metadata-only', '--silent');
        await run();
        expect(pdfToPng).toHaveBeenCalledTimes(1);
        expect(logSpy).not.toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalled();
    });

    // ── Error from pdfToPng ───────────────────────────────────────────────────

    it('exits 1 and prints the error when pdfToPng throws', async () => {
        vi.mocked(pdfToPng).mockRejectedValueOnce(new Error('render failed'));

        setArgv('test.pdf', '--output-folder', '/out');
        await run();

        expect(errorSpy).toHaveBeenCalledWith('Error:');
        expect(errorSpy).toHaveBeenCalledWith('render failed');
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('handles non-Error rejections from pdfToPng', async () => {
        vi.mocked(pdfToPng).mockRejectedValueOnce('string error');

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
    it('exports run, HELP_TEXT, parseBoolean, and parseNumberList', () => {
        expect(typeof cli.run).toBe('function');
        expect(typeof cli.HELP_TEXT).toBe('string');
        expect(typeof cli.parseBoolean).toBe('function');
        expect(typeof cli.parseNumberList).toBe('function');
        expect(typeof cli.getVersion).toBe('function');
    });
});
