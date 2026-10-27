import { execSync, spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';

/**
 * The CLI as users run it: compiled JavaScript in a fresh process. The in-process tests in `cli.test.ts` mock the
 * conversion and set `process.argv` by hand, so they cannot see how `node` launches the entry module or what a real
 * pdf.js writes to stdout.
 *
 * The child loads compiled JavaScript from its own folder, not `out/`: the worker-thread tests compile `out/` and load
 * `out/pageRenderWorker.js` while they run, so a second compile there could overwrite it mid-test. `package.json` is not
 * copied next to the compiled files, so these cases use `--help` where they need output and never `--version`.
 */
const repositoryRoot = resolve(__dirname, '..');
const compiledDirectory = join(repositoryRoot, 'test-results', 'cli-compiled-out');
const cliPath = join(compiledDirectory, 'cli.js');
const USAGE_LINE = 'Usage: pdf-to-png-converter <pdf-file-path> [options]';

beforeAll(() => {
    try {
        execSync(`npx tsc --project tsconfig.prod.json --outDir ${JSON.stringify(compiledDirectory)}`, {
            cwd: repositoryRoot,
            stdio: 'pipe',
        });
    } catch (error) {
        const output = error as { stdout?: Buffer; stderr?: Buffer };
        throw new Error(`CLI build (tsc) failed:\n${output.stdout?.toString() ?? ''}\n${output.stderr?.toString() ?? ''}`, {
            cause: error,
        });
    }
}, 120_000);

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), 'pdf-to-png-cli-'));
    temporaryDirectories.push(directory);
    return directory;
}

afterEach(() => {
    // Plain directories and symbolic links only, so a recursive delete cannot reach node_modules.
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});

type Environment = typeof process.env;

/** A child's environment without anything that could change its output, plus the variables a case sets. */
function childEnvironment(extra: Environment = {}): Environment {
    const environment = { ...process.env };
    for (const name of ['NODE_OPTIONS', 'NODE_V8_COVERAGE', 'NODE_NO_WARNINGS', 'PDF_TO_PNG_PASSWORD']) {
        delete environment[name];
    }
    return { ...environment, ...extra };
}

function runNode(args: string[], options: { cwd?: string; env?: Environment } = {}): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, args, {
        cwd: options.cwd,
        env: childEnvironment(options.env),
        encoding: 'utf8',
        timeout: 120_000,
    });
}

describe('entry point', () => {
    // Node resolves `node out/cli` to `out/cli.js` but leaves `process.argv[1]` without the extension. A launch that
    // runs nothing exits 0 silently, so every form is checked twice: help on stdout, and a usage error with exit code 1.
    test.each([
        ['with the .js extension', cliPath, undefined],
        ['by an absolute path without the .js extension', join(compiledDirectory, 'cli'), undefined],
        ['by a relative path without the .js extension', './cli', compiledDirectory],
    ])('node runs the CLI %s', (_form, entry, cwd) => {
        const help = runNode([entry, '--help'], { cwd });
        expect(help.status, help.stderr).toBe(0);
        expect(help.stdout).toContain(USAGE_LINE);

        const usageError = runNode([entry], { cwd });
        expect(usageError.status).toBe(1);
        expect(usageError.stderr).toContain('Error: <pdf-file-path> is required.');
    });

    // The npm `.bin` link is a symbolic link named after the command, so it has no extension either.
    test.skipIf(process.platform === 'win32')('node runs the CLI through a symbolic link without an extension', () => {
        const link = join(makeTemporaryDirectory(), 'pdf-to-png-converter');
        symlinkSync(cliPath, link);

        const help = runNode([link, '--help']);
        expect(help.status, help.stderr).toBe(0);
        expect(help.stdout).toContain(USAGE_LINE);
    });

    test('requiring the compiled module from another script does not start the CLI', () => {
        const consumer = join(makeTemporaryDirectory(), 'consumer.js');
        writeFileSync(consumer, `const { run } = require(${JSON.stringify(cliPath)});\nconsole.log(typeof run);\n`);

        const result = runNode([consumer, '--help']);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe('function\n');
    });

    test('requiring the compiled module without an entry script does not start the CLI', () => {
        const result = runNode(['-e', `require(${JSON.stringify(cliPath)})`]);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('');
    });
});

describe('--return-metadata-only', () => {
    // A startxref offset far beyond the end of the file makes pdf.js log "Info: (while reading XRef): ..." at verbosity 5
    // and rebuild the table by scanning the file. pdf.js writes Info lines with console.info, which is stdout.
    test('prints only JSON on stdout at verbosity 5 and sends the pdf.js Info lines to stderr', () => {
        const original = readFileSync(join(repositoryRoot, 'test-data', 'sample.pdf'));
        const startxref = original.lastIndexOf('startxref');
        expect(startxref).toBeGreaterThan(0);
        const damagedPdf = join(makeTemporaryDirectory(), 'damaged-xref.pdf');
        writeFileSync(damagedPdf, Buffer.concat([original.subarray(0, startxref), Buffer.from('startxref\n999999\n%%EOF\n')]));

        const result = runNode([cliPath, damagedPdf, '--return-metadata-only', '--verbosity-level', '5']);

        expect(result.status, result.stderr).toBe(0);
        const pages = JSON.parse(result.stdout) as Array<{ pageNumber: number }>;
        expect(pages.map((page) => page.pageNumber)).toEqual([1, 2]);
        // The trigger fired and the verbosity option still works. Without this the test would pass vacuously if pdf.js
        // stopped logging for this file.
        expect(result.stderr).toContain('Info: ');
    });
});

describe('PDF_TO_PNG_PASSWORD', () => {
    // The password of the encrypted fixture, which is public (see protected.pdf.test.ts).
    const FIXTURE_PASSWORD = 'uES69xm545C/HP!';

    test('opens an encrypted PDF when --pdf-file-password is absent', () => {
        const args = [
            cliPath,
            join(repositoryRoot, 'test-data', 'large_pdf-protected.pdf'),
            '--return-metadata-only',
            '--pages-to-process',
            '1',
        ];

        const withoutPassword = runNode(args);
        expect(withoutPassword.status).toBe(1);

        const withPassword = runNode(args, { env: { PDF_TO_PNG_PASSWORD: FIXTURE_PASSWORD } });
        expect(withPassword.status, withPassword.stderr).toBe(0);
        expect(JSON.parse(withPassword.stdout)).toHaveLength(1);
        expect(withPassword.stdout + withPassword.stderr).not.toContain(FIXTURE_PASSWORD);
    });
});
