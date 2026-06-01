#!/usr/bin/env node

import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { pdfToPngCore } from './pdfToPngCore.js';
import type { PdfToPngOptions } from './interfaces/pdf.to.png.options.js';
import { normalizePdfToPngOptions, type NormalizedPdfToPngOptions } from './normalizePdfToPngOptions.js';

/**
 * Help text shown for `--help` and on invalid usage.
 * Exported so it can be asserted in tests without running the full CLI pipeline.
 */
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
  --concurrency-limit <number>      Maximum number of pages rendered simultaneously
  --silent                          Suppress output unless there is an error
  --version                         Show version
  --help                            Show this help message`;

/**
 * Shared `parseArgs` option schema.
 * Declared `as const` so TypeScript infers precise `'string'` / `'boolean'` literal types
 * for every flag and propagates them through the `parseArgs` return type.
 */
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
    silent: { type: 'boolean' },
    version: { type: 'boolean' },
    help: { type: 'boolean' },
} as const;

type ParsedValues = {
    'output-folder'?: string;
    'viewport-scale'?: string;
    'use-system-fonts'?: boolean;
    'disable-font-face'?: string;
    'enable-xfa'?: string;
    'pdf-file-password'?: string;
    'pages-to-process'?: string;
    'verbosity-level'?: string;
    'return-metadata-only'?: boolean;
    'return-page-content'?: boolean;
    'process-pages-in-parallel'?: boolean;
    'concurrency-limit'?: string;
    silent?: boolean;
    version?: boolean;
    help?: boolean;
};

type CliParseResult = { values: ParsedValues; positionals: string[] };

/**
 * Parses a CLI string value as a boolean.
 *
 * - `'true'` / `'1'` → `true`
 * - `'false'` / `'0'` → `false`
 * - `undefined` → `undefined` (flag not provided)
 *
 * @throws {Error} When the value is not a recognised boolean string.
 */
export function parseBoolean(val: string | undefined): boolean | undefined {
    if (val === undefined) return undefined;
    if (val === 'true' || val === '1') return true;
    if (val === 'false' || val === '0') return false;
    throw new Error(`Invalid boolean value: "${val}". Expected true|false|1|0.`);
}

/**
 * Parses a comma-separated string of integers into a `number[]`.
 *
 * Returns `undefined` when `val` is `undefined` (flag not provided).
 *
 * @throws {Error} When any token in the list is not a valid integer.
 */
export function parseNumberList(val: string | undefined): number[] | undefined {
    if (val === undefined) return undefined;
    return val.split(',').map((token) => {
        const trimmed = token.trim();
        if (trimmed === '') throw new Error('Invalid integer in list: empty value.');
        const parsed = Number(trimmed);
        if (!Number.isInteger(parsed)) throw new Error(`Invalid integer in list: "${trimmed}".`);
        return parsed;
    });
}

function parseNumericOption(value: string | undefined, errorMessage: string): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value.trim() === '') {
        throw new Error(errorMessage);
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(errorMessage);
    }

    return parsed;
}

function parseIntegerOption(value: string | undefined, errorMessage: string): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value.trim() === '') {
        throw new Error(errorMessage);
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
        throw new Error(errorMessage);
    }

    return parsed;
}

function safeParseArgs(): CliParseResult | null {
    try {
        return parseArgs({ options: CLI_OPTIONS, allowPositionals: true }) as CliParseResult;
    } catch (err: unknown) {
        /* v8 ignore next */
        console.error(err instanceof Error ? err.message : String(err));
        console.error(HELP_TEXT);
        process.exit(1);
        return null;
    }
}

/**
 * Parses raw CLI flags into a validated `NormalizedPdfToPngOptions` plus the positional
 * `pdfFilePath`. Single source of normalization — downstream {@link executeConversion}
 * passes the result straight to {@link pdfToPngCore} so the library does NOT re-normalize.
 *
 * The CLI only supports stdout-friendly metadata mode (`--return-metadata-only`) or
 * file-writing image conversion (`--output-folder`). In-memory PNG buffers remain a
 * library-only capability because the CLI does not serialize page results.
 */
export function buildPdfToPngOptions(
    values: ParsedValues,
    positionals: string[],
): { pdfFilePath: string; options: NormalizedPdfToPngOptions } {
    const pdfFilePath = positionals[0];
    if (!pdfFilePath) {
        throw new Error('<pdf-file-path> is required.');
    }

    const rawOptions: PdfToPngOptions = {
        outputFolder: values['output-folder'],
        viewportScale: parseNumericOption(values['viewport-scale'], '--viewport-scale must be a valid number.'),
        useSystemFonts: values['use-system-fonts'],
        disableFontFace: parseBoolean(values['disable-font-face']),
        enableXfa: parseBoolean(values['enable-xfa']),
        pdfFilePassword: values['pdf-file-password'],
        pagesToProcess: parseNumberList(values['pages-to-process']),
        verbosityLevel: parseIntegerOption(values['verbosity-level'], '--verbosity-level must be a valid integer.'),
        returnMetadataOnly: values['return-metadata-only'],
        returnPageContent: values['return-page-content'] ?? false,
        processPagesInParallel: values['process-pages-in-parallel'],
        concurrencyLimit: parseIntegerOption(values['concurrency-limit'], '--concurrency-limit must be a valid integer.'),
    };

    const options = normalizePdfToPngOptions(rawOptions);

    if (values['return-page-content']) {
        throw new Error('--return-page-content is not supported by the CLI. Use the library API if you need in-memory PNG buffers.');
    }

    if (!options.returnMetadataOnly && options.outputFolder === undefined) {
        throw new Error(
            'The CLI requires --output-folder for image conversion. Use --return-metadata-only for stdout-friendly page metadata.',
        );
    }

    return { pdfFilePath, options };
}

export async function executeConversion(
    pdfFilePath: string,
    options: NormalizedPdfToPngOptions,
    logInfo: (...msgs: unknown[]) => void,
    writeOutput: (...msgs: unknown[]) => void = console.log,
): Promise<void> {
    try {
        const results = await pdfToPngCore(pdfFilePath, options);
        if (options.returnMetadataOnly) {
            writeOutput(JSON.stringify(results, null, 2));
            return;
        }

        logInfo(`Successfully processed ${results.length} page(s).`);
    } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : String(err), {
            cause: err,
        });
    }
}

function createLogger(silent: boolean | undefined): (...msgs: unknown[]) => void {
    return (...msgs: unknown[]): void => {
        if (!silent) console.log(...msgs);
    };
}

function handleRunError(err: unknown): void {
    if (err instanceof Error && err.cause !== undefined) {
        console.error('Error:');
        console.error(err.message);
    } else {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (err instanceof Error && err.message === '<pdf-file-path> is required.') {
        console.error(HELP_TEXT);
    }

    process.exit(1);
}

/**
 * Reads the package version from the adjacent `package.json`.
 * Throws when `package.json` is missing or malformed so packaging defects surface immediately.
 */
export function getVersion(): string {
    try {
        const pkgPath = path.resolve(__dirname, '../package.json');
        const pkgInfo = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
        if (typeof pkgInfo.version !== 'string' || pkgInfo.version.length === 0) {
            throw new Error('Cannot determine package version: package.json missing or malformed');
        }
        return pkgInfo.version;
    } catch {
        throw new Error('Cannot determine package version: package.json missing or malformed');
    }
}

/**
 * Main CLI entry point.
 *
 * Parses `process.argv`, validates all options up-front through
 * {@link normalizePdfToPngOptions} via {@link buildPdfToPngOptions}, and delegates to
 * {@link pdfToPngCore}. Exported so it can be unit-tested without spawning a child process.
 */
export async function run(): Promise<void> {
    const parseResult = safeParseArgs();
    if (!parseResult) return;

    const { values, positionals } = parseResult;

    if (values.help) {
        console.log(HELP_TEXT);
        process.exit(0);
        return;
    }

    if (values.version) {
        try {
            console.log(`v${getVersion()}`);
            process.exit(0);
        } catch (err: unknown) {
            console.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
        return;
    }

    try {
        const { pdfFilePath, options } = buildPdfToPngOptions(values, positionals);
        const logInfo = createLogger(values.silent);
        if (!options.returnMetadataOnly) {
            logInfo(`Processing PDF: ${pdfFilePath}`);
            if (options.outputFolder) {
                logInfo(`Output folder: ${options.outputFolder}`);
            }
        }
        await executeConversion(pdfFilePath, options, logInfo);
    } catch (err: unknown) {
        handleRunError(err);
    }
}

/* v8 ignore next 6 */
try {
    if (fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename)) {
        void run();
    }
} catch {
    // realpathSync can fail (e.g. path does not exist) — skip auto-execution
}
