#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { assertValidPdfToPngOptions, pdfToPng } from './pdfToPng.js';
import type { PdfToPngOptions } from './types.js';

export const HELP_TEXT = `Usage: pdf-to-png-converter <pdf-file-path> [options]

Options:
  --output-folder <dir>             Folder path where PNG files will be written (required unless --return-metadata-only)
  --viewport-scale <number>         Scale factor applied to each page viewport
  --use-system-fonts                Attempt to use fonts installed on the host system
  --disable-font-face <true|false>  Do not load embedded fonts (true/false)
  --enable-xfa <true|false>         Process XFA form data (true/false)
  --pdf-file-password <pwd>         Password for encrypted PDFs
  --pages-to-process <n,m,...>      Comma-separated list of 1-based page numbers
  --verbosity-level <number>        pdfjs verbosity level (0=errors, 1=warnings, 5=infos)
  --return-metadata-only            Return page metadata without rendering images
  --process-pages-in-parallel       Process pages concurrently
  --concurrency-limit <number>      Max concurrent pages (parallel) / worker-pool size (worker threads)
  --render-in-worker-threads        Rasterize pages in a pool of worker threads (multi-core)
  --silent                          Suppress output unless there is an error
  --version                         Show version
  --help                            Show this help message`;

const CLI_OPTIONS = {
    'output-folder': { type: 'string' },
    'viewport-scale': { type: 'string' },
    'use-system-fonts': { type: 'boolean' },
    'disable-font-face': { type: 'string' },
    'enable-xfa': { type: 'string' },
    'pdf-file-password': { type: 'string' },
    'pages-to-process': { type: 'string' },
    'verbosity-level': { type: 'string' },
    'return-metadata-only': { type: 'boolean' },
    'return-page-content': { type: 'boolean' },
    'process-pages-in-parallel': { type: 'boolean' },
    'concurrency-limit': { type: 'string' },
    'render-in-worker-threads': { type: 'boolean' },
    silent: { type: 'boolean' },
    version: { type: 'boolean' },
    help: { type: 'boolean' },
} as const;

const PARSE_CONFIG = { options: CLI_OPTIONS, allowPositionals: true } as const;
type ParsedValues = ReturnType<typeof parseArgs<typeof PARSE_CONFIG>>['values'];

function parseBoolean(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    throw new Error(`Invalid boolean value: "${value}". Expected true|false|1|0.`);
}

function parseNumberList(value: string | undefined): number[] | undefined {
    if (value === undefined) return undefined;
    return value.split(',').map((token) => {
        const trimmed = token.trim();
        if (trimmed === '') throw new Error('Invalid integer in list: empty value.');
        const parsed = Number(trimmed);
        if (!Number.isInteger(parsed)) throw new Error(`Invalid integer in list: "${trimmed}".`);
        return parsed;
    });
}

function parseNumber(value: string | undefined, errorMessage: string, integer = false): number | undefined {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (value.trim() === '' || !Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
        throw new Error(errorMessage);
    }
    return parsed;
}

function buildConversion(values: ParsedValues, positionals: string[]): { pdfFilePath: string; options: PdfToPngOptions } {
    const pdfFilePath = positionals[0];
    if (!pdfFilePath) throw new Error('<pdf-file-path> is required.');

    const options: PdfToPngOptions = {
        outputFolder: values['output-folder'],
        viewportScale: parseNumber(values['viewport-scale'], '--viewport-scale must be a valid number.'),
        useSystemFonts: values['use-system-fonts'],
        disableFontFace: parseBoolean(values['disable-font-face']),
        enableXfa: parseBoolean(values['enable-xfa']),
        pdfFilePassword: values['pdf-file-password'],
        pagesToProcess: parseNumberList(values['pages-to-process']),
        verbosityLevel: parseNumber(values['verbosity-level'], '--verbosity-level must be a valid integer.', true),
        returnMetadataOnly: values['return-metadata-only'],
        returnPageContent: false,
        processPagesInParallel: values['process-pages-in-parallel'],
        concurrencyLimit: parseNumber(values['concurrency-limit'], '--concurrency-limit must be a valid integer.', true),
        renderInWorkerThreads: values['render-in-worker-threads'],
    };

    return { pdfFilePath, options };
}

export function getVersion(): string {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')) as { version?: unknown };
        if (typeof pkg.version === 'string' && pkg.version !== '') return pkg.version;
    } catch {
        // Normalized below so packaging defects have one stable CLI error.
    }
    throw new Error('Cannot determine package version: package.json missing or malformed');
}

function fail(error: unknown): void {
    if (error instanceof Error && error.cause !== undefined) {
        console.error('Error:');
        console.error(error.message);
    } else {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (error instanceof Error && error.message === '<pdf-file-path> is required.') console.error(HELP_TEXT);
    process.exit(1);
}

/** Parses argv, delegates conversion to the public library interface, and prints CLI output. */
export async function run(): Promise<void> {
    let parsed: ReturnType<typeof parseArgs<typeof PARSE_CONFIG>>;
    try {
        parsed = parseArgs(PARSE_CONFIG);
    } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : String(error));
        console.error(HELP_TEXT);
        process.exit(1);
        return;
    }

    if (parsed.values.help) {
        console.log(HELP_TEXT);
        process.exit(0);
        return;
    }
    if (parsed.values.version) {
        try {
            console.log(`v${getVersion()}`);
            process.exit(0);
        } catch (error: unknown) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
        return;
    }

    try {
        const { pdfFilePath, options } = buildConversion(parsed.values, parsed.positionals);

        // Validate the same contract as the library before CLI-only policy and progress output.
        // pdfToPng validates again at its public boundary for callers that bypass this adapter.
        assertValidPdfToPngOptions(options);
        if (parsed.values['return-page-content']) {
            throw new Error('--return-page-content is not supported by the CLI. Use the library API if you need in-memory PNG buffers.');
        }
        if (!options.returnMetadataOnly && options.outputFolder === undefined) {
            throw new Error(
                'The CLI requires --output-folder for image conversion. Use --return-metadata-only for stdout-friendly page metadata.',
            );
        }

        if (!options.returnMetadataOnly && !parsed.values.silent) {
            console.log(`Processing PDF: ${pdfFilePath}`);
            console.log(`Output folder: ${options.outputFolder}`);
        }

        let results;
        try {
            results = await pdfToPng(pdfFilePath, options);
        } catch (error: unknown) {
            // Keep conversion failures visually distinct from argv/usage failures, matching the
            // established CLI output while preserving the original value as the cause.
            throw new Error(error instanceof Error ? error.message : String(error), { cause: error });
        }
        if (options.returnMetadataOnly) {
            console.log(JSON.stringify(results, null, 2));
        } else if (!parsed.values.silent) {
            console.log(`Successfully processed ${results.length} page(s).`);
        }
    } catch (error: unknown) {
        fail(error);
    }
}

try {
    if (fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename)) void run();
} catch {
    // A missing argv path means this module was not invoked as the CLI entry.
}
