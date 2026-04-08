#!/usr/bin/env node

import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { pdfToPng } from './pdfToPng.js';
import type { PdfToPngOptions } from './interfaces/pdf.to.png.options.js';

const HELP_TEXT = `
Usage: pdf-to-png-converter <pdf-file-path> [options]

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
  --return-page-content             Include rendered PNG buffers in the returned results
  --process-pages-in-parallel       Process pages concurrently
  --concurrency-limit <number>      Maximum number of pages rendered simultaneously
  --silent                          Suppress output unless there is an error
  --version                         Show version
  --help                            Show this help message
`;

function parseBoolean(val: string | undefined): boolean | undefined {
    if (val === undefined) return undefined;
    if (val === 'true' || val === '1') return true;
    if (val === 'false' || val === '0') return false;
    throw new Error(`Invalid boolean value: ${val}`);
}

function parseNumberList(val: string | undefined): number[] | undefined {
    if (val === undefined) return undefined;
    return val.split(',').map((num) => {
        const parsed = parseInt(num.trim(), 10);
        if (isNaN(parsed)) throw new Error(`Invalid number in list: ${num}`);
        return parsed;
    });
}

function getVersion(): string {
    try {
        const pkgPath = path.resolve(__dirname, '../package.json');
        const pkgInfo = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkgInfo.version ?? 'Unknown';
    } catch {
        return 'Unknown';
    }
}

async function run(): Promise<void> {
    const args = ((): ReturnType<typeof parseArgs> => {
        try {
            return parseArgs({
                options: {
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
                },
                allowPositionals: true,
            });
        } catch (err: unknown) {
            console.error(err instanceof Error ? err.message : String(err));
            console.error(HELP_TEXT);
            process.exit(1);
            throw err; // unreachable; satisfies return type
        }
    })();

    const { values, positionals } = args;

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

    const log = (...msgs: unknown[]): void => {
        if (!values.silent) console.log(...msgs);
    };

    try {
        const options: PdfToPngOptions = {
            outputFolder: values['output-folder'] as string | undefined,
            useSystemFonts: values['use-system-fonts'] as boolean | undefined,
            pdfFilePassword: values['pdf-file-password'] as string | undefined,
            returnMetadataOnly: values['return-metadata-only'] as boolean | undefined,
            returnPageContent: values['return-page-content'] as boolean | undefined,
            processPagesInParallel: values['process-pages-in-parallel'] as boolean | undefined,
        };

        if (values['viewport-scale'] !== undefined) {
            options.viewportScale = parseFloat(values['viewport-scale'] as string);
        }
        if (values['disable-font-face'] !== undefined) {
            options.disableFontFace = parseBoolean(values['disable-font-face'] as string);
        }
        if (values['enable-xfa'] !== undefined) {
            options.enableXfa = parseBoolean(values['enable-xfa'] as string);
        }
        if (values['pages-to-process'] !== undefined) {
            options.pagesToProcess = parseNumberList(values['pages-to-process'] as string);
        }
        if (values['verbosity-level'] !== undefined) {
            options.verbosityLevel = parseInt(values['verbosity-level'] as string, 10);
        }
        if (values['concurrency-limit'] !== undefined) {
            options.concurrencyLimit = parseInt(values['concurrency-limit'] as string, 10);
        }

        log(`Processing PDF: ${pdfFilePath}`);
        if (options.outputFolder) {
            log(`Output folder: ${options.outputFolder}`);
        }

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

if (process.argv[1] === __filename) {
    void run();
}

export { run }; // export for testing support
