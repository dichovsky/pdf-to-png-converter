#!/usr/bin/env node

import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { pdfToPng } from './pdfToPng.js';
import type { PdfToPngOptions } from './interfaces/pdf.to.png.options.js';

/**
 * Help text shown for `--help` and on invalid usage.
 * Exported so it can be asserted in tests without running the full CLI pipeline.
 */
export const HELP_TEXT = `Usage: pdf-to-png-converter <pdf-file-path> [options]

Options:
  --output-folder <dir>             Folder path where PNG files will be written
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
    'process-pages-in-parallel': { type: 'boolean' },
    'concurrency-limit': { type: 'string' },
    silent: { type: 'boolean' },
    version: { type: 'boolean' },
    help: { type: 'boolean' },
} as const;

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
        const parsed = parseInt(token.trim(), 10);
        if (isNaN(parsed)) throw new Error(`Invalid integer in list: "${token.trim()}".`);
        return parsed;
    });
}

/**
 * Reads the package version from the adjacent `package.json`.
 * Falls back to `'Unknown'` on any I/O or parse error so that `--version`
 * always returns a printable string.
 */
export function getVersion(): string {
    try {
        const pkgPath = path.resolve(__dirname, '../package.json');
        const pkgInfo = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
        return pkgInfo.version ?? 'Unknown';
    } catch {
        return 'Unknown';
    }
}

/**
 * Main CLI entry point.
 *
 * Parses `process.argv`, validates all options up-front with actionable error messages,
 * and delegates to {@link pdfToPng}. Exported so it can be unit-tested without
 * spawning a child process.
 */
export async function run(): Promise<void> {
    // parseArgs throws on unknown flags (strict mode is on by default).
    // Wrap in an IIFE that returns null on failure so the outer scope
    // can use a const binding and guard cleanly when process.exit is mocked.
    const parseResult = (() => {
        try {
            return parseArgs({ options: CLI_OPTIONS, allowPositionals: true });
        } catch (err: unknown) {
            /* v8 ignore next */
            console.error(err instanceof Error ? err.message : String(err));
            console.error(HELP_TEXT);
            process.exit(1);
            return null; // only reached when process.exit is mocked (e.g. unit tests)
        }
    })();

    // Guard: if process.exit was mocked and parseArgs failed, return early.
    if (!parseResult) return;

    const { values, positionals } = parseResult;

    if (values.help) {
        console.log(HELP_TEXT);
        process.exit(0);
        return;
    }

    if (values.version) {
        console.log(`v${getVersion()}`);
        process.exit(0);
        return;
    }

    const pdfFilePath = positionals[0];

    if (!pdfFilePath) {
        console.error('Error: <pdf-file-path> is required.');
        console.error(HELP_TEXT);
        process.exit(1);
        return;
    }

    if (!values['output-folder'] && !values['return-metadata-only']) {
        console.error('Error: --output-folder is required unless --return-metadata-only is specified.');
        console.error(HELP_TEXT);
        process.exit(1);
        return;
    }

    // ── Validate numeric options up-front for actionable error messages ───────

    let viewportScale: number | undefined;
    if (values['viewport-scale'] !== undefined) {
        viewportScale = parseFloat(values['viewport-scale']);
        if (isNaN(viewportScale)) {
            console.error('Error: --viewport-scale must be a valid number.');
            process.exit(1);
            return;
        }
    }

    let verbosityLevel: number | undefined;
    if (values['verbosity-level'] !== undefined) {
        verbosityLevel = parseInt(values['verbosity-level'], 10);
        if (isNaN(verbosityLevel)) {
            console.error('Error: --verbosity-level must be a valid integer.');
            process.exit(1);
            return;
        }
    }

    let concurrencyLimit: number | undefined;
    if (values['concurrency-limit'] !== undefined) {
        concurrencyLimit = parseInt(values['concurrency-limit'], 10);
        if (isNaN(concurrencyLimit)) {
            console.error('Error: --concurrency-limit must be a valid integer.');
            process.exit(1);
            return;
        }
    }

    // ── Validate boolean / list options (helpers throw on bad input) ──────────

    let disableFontFace: boolean | undefined;
    let enableXfa: boolean | undefined;
    let pagesToProcess: number[] | undefined;

    try {
        disableFontFace = parseBoolean(values['disable-font-face']);
        enableXfa = parseBoolean(values['enable-xfa']);
        pagesToProcess = parseNumberList(values['pages-to-process']);
    } catch (err: unknown) {
        /* v8 ignore next */
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
        return;
    }

    // ── Build options and invoke pdfToPng ─────────────────────────────────────

    /** Logs to stdout unless `--silent` is set. */
    const log = (...msgs: unknown[]): void => {
        if (!values.silent) console.log(...msgs);
    };

    // All PdfToPngOptions properties are set explicitly (to undefined when not provided)
    // so the object passed to pdfToPng is fully predictable and easy to assert in tests.
    const options: PdfToPngOptions = {
        outputFolder: values['output-folder'],
        viewportScale,
        useSystemFonts: values['use-system-fonts'],
        disableFontFace,
        enableXfa,
        pdfFilePassword: values['pdf-file-password'],
        pagesToProcess,
        verbosityLevel,
        returnMetadataOnly: values['return-metadata-only'],
        processPagesInParallel: values['process-pages-in-parallel'],
        concurrencyLimit,
        // CLI writes to disk — no need to buffer PNG bytes in memory after each page is saved.
        returnPageContent: false,
    };

    log(`Processing PDF: ${pdfFilePath}`);
    if (options.outputFolder) {
        log(`Output folder: ${options.outputFolder}`);
    }

    try {
        const results = await pdfToPng(pdfFilePath, options);

        if (values['return-metadata-only']) {
            log('Metadata extraction complete:');
            log(JSON.stringify(results, null, 2));
        } else {
            log(`Successfully processed ${results.length} page(s).`);
        }
    } catch (err: unknown) {
        console.error('Error:');
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}

/* v8 ignore next 3 */
if (process.argv[1] === __filename) {
    void run();
}
