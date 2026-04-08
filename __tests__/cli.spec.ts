import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as cli from '../src/cli.js';
import { pdfToPng } from '../src/pdfToPng.js';

vi.mock('../src/pdfToPng.js', () => ({
    pdfToPng: vi.fn().mockResolvedValue([]),
}));

describe('CLI Options Parser', () => {
    let exitSpy: any;
    let logSpy: any;
    let errorSpy: any;
    let originalArgv: string[];

    beforeEach(() => {
        exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        originalArgv = process.argv;
        vi.clearAllMocks();
    });

    afterEach(() => {
        process.argv = originalArgv;
        vi.restoreAllMocks();
    });

    it('should print help and exit 0 when --help is passed', async () => {
        process.argv = ['node', 'cli.js', '--help'];
        await cli.run();
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Usage: pdf-to-png-converter'));
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('should print version and exit 0 when --version is passed', async () => {
        process.argv = ['node', 'cli.js', '--version'];
        await cli.run();
        expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^v\d+\.\d+\.\d+/)); // vX.X.X
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('should fail if no pdf path is provided', async () => {
        process.argv = ['node', 'cli.js'];
        await cli.run();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('<pdf-file-path> is required'));
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should fail if no output folder is provided (and not metadata only)', async () => {
        process.argv = ['node', 'cli.js', 'test.pdf'];
        await cli.run();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--output-folder is required'));
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should call pdfToPng with parsed arguments', async () => {
        process.argv = [
            'node',
            'cli.js',
            'test.pdf',
            '--output-folder',
            '/out',
            '--viewport-scale',
            '2',
            '--use-system-fonts',
            '--disable-font-face',
            'false',
            '--pages-to-process',
            '1,2,3',
            '--verbosity-level',
            '1',
            '--process-pages-in-parallel',
            '--concurrency-limit',
            '2',
        ];

        await cli.run();

        expect(pdfToPng).toHaveBeenCalledTimes(1);
        expect(pdfToPng).toHaveBeenCalledWith('test.pdf', {
            outputFolder: '/out',
            viewportScale: 2,
            useSystemFonts: true,
            disableFontFace: false,
            pagesToProcess: [1, 2, 3],
            verbosityLevel: 1,
            processPagesInParallel: true,
            concurrencyLimit: 2,
            returnPageContent: false, // expected default via CLI
            enableXfa: undefined,
            pdfFilePassword: undefined,
            returnMetadataOnly: undefined,
        });
        expect(logSpy).toHaveBeenCalledWith('Processing PDF: test.pdf');
    });

    it('should support --silent mode', async () => {
        process.argv = ['node', 'cli.js', 'test.pdf', '--output-folder', '/out', '--silent'];

        await cli.run();

        expect(pdfToPng).toHaveBeenCalledTimes(1);
        expect(logSpy).not.toHaveBeenCalled(); // No logs expected
    });
});
