/**
 * End-to-end benchmark for the published `pdfToPng()` interface.
 *
 * The default run is intentionally small enough for routine local use:
 *
 *   npm run bench
 *
 * Configure the content fixture, requested page counts, or execution modes with environment
 * variables. Relative fixture names without a directory are resolved under `test-data/`.
 *
 *   BENCH_FIXTURE=TAMReview.pdf BENCH_PAGES=1,5,20 npm run bench
 *   BENCH_MODES=default,parallel,worker,file npm run bench
 *   BENCH_ITERATIONS=5 BENCH_WARMUP=1 BENCH_CONCURRENCY=4 npm run bench
 *
 * Modes: default, parallel, worker, file, file-parallel, file-worker, metadata.
 * Each scenario runs in a fresh child process so peak RSS is a scenario-local high-water mark.
 * Results are printed and saved under the gitignored `bench-results/` directory.
 */
import { spawn } from 'node:child_process';
import { promises as fsPromises } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { PdfToPngOptions } from '../out/index.js';
import { pdfToPng } from '../out/index.js';

const REPO_ROOT = resolve(__dirname, '..');
const TEST_DATA_ROOT = join(REPO_ROOT, 'test-data');
const RESULTS_ROOT = join(REPO_ROOT, 'bench-results');
const TEMP_ROOT = join(RESULTS_ROOT, 'tmp');
const CHILD_SCENARIO_ENV = 'BENCH_CHILD_SCENARIO';
const CHILD_RESULT_PREFIX = 'BENCH_RESULT=';

const BENCH_MODES = ['default', 'parallel', 'worker', 'file', 'file-parallel', 'file-worker', 'metadata'] as const;
type BenchMode = (typeof BENCH_MODES)[number];

interface BenchmarkConfig {
    fixture: string;
    pageCounts: number[];
    modes: BenchMode[];
    iterations: number;
    warmupIterations: number;
    concurrencyLimit: number;
    label: string;
}

interface Scenario {
    fixture: string;
    fixturePages: number;
    requestedPages: number;
    mode: BenchMode;
    iterations: number;
    warmupIterations: number;
    concurrencyLimit: number;
    outputFolder: string;
}

interface TimingSample {
    wallMs: number;
    userCpuMs: number;
    systemCpuMs: number;
}

interface ScenarioResult {
    mode: BenchMode;
    requestedPages: number;
    pages: number;
    iterations: number;
    medianWallMs: number;
    minWallMs: number;
    meanWallMs: number;
    medianWallMsPerPage: number;
    medianCpuMs: number;
    medianUserCpuMs: number;
    medianSystemCpuMs: number;
    peakRssMiB: number;
}

function readInteger(name: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
    const raw = process.env[name];
    if (raw === undefined) return fallback;

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}, received: ${raw}`);
    }
    return parsed;
}

function readPageCounts(): number[] {
    const raw = process.env.BENCH_PAGES ?? '1,5';
    const counts = raw.split(',').map((token) => {
        const parsed = Number(token.trim());
        if (!Number.isInteger(parsed) || parsed < 1) {
            throw new Error(`BENCH_PAGES must contain positive integers, received: ${raw}`);
        }
        return parsed;
    });
    return [...new Set(counts)];
}

function isBenchMode(value: string): value is BenchMode {
    return (BENCH_MODES as readonly string[]).includes(value);
}

function readModes(): BenchMode[] {
    const raw = process.env.BENCH_MODES ?? process.env.BENCH_MODE ?? 'default,parallel,worker';
    const modes = raw.split(',').map((token) => token.trim());
    if (modes.some((mode) => !isBenchMode(mode))) {
        throw new Error(`BENCH_MODES must use ${BENCH_MODES.join(', ')}, received: ${raw}`);
    }
    return [...new Set(modes)] as BenchMode[];
}

function resolveFixture(raw: string): string {
    if (isAbsolute(raw)) return raw;
    return raw.includes('/') || raw.includes('\\') ? resolve(REPO_ROOT, raw) : join(TEST_DATA_ROOT, raw);
}

function readLabel(): string {
    const label = process.env.BENCH_LABEL ?? new Date().toISOString().replace(/[:.]/g, '-');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label) || label === '.' || label === '..') {
        throw new Error(`BENCH_LABEL must be a filename-safe label, received: ${label}`);
    }
    return label;
}

function readConfig(): BenchmarkConfig {
    return {
        fixture: resolveFixture(process.env.BENCH_FIXTURE ?? 'large_pdf.pdf'),
        pageCounts: readPageCounts(),
        modes: readModes(),
        iterations: readInteger('BENCH_ITERATIONS', 3, 1),
        warmupIterations: readInteger('BENCH_WARMUP', 1, 0),
        concurrencyLimit: readInteger('BENCH_CONCURRENCY', 4, 1, 16),
        label: readLabel(),
    };
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function mean(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isFileMode(mode: BenchMode): boolean {
    return mode === 'file' || mode === 'file-parallel' || mode === 'file-worker';
}

function buildOptions(scenario: Scenario): PdfToPngOptions {
    let outputSequence = 0;
    const options: PdfToPngOptions = {
        pagesToProcess: Array.from({ length: scenario.requestedPages }, (_, index) => (index % scenario.fixturePages) + 1),
        returnPageContent: true,
    };

    if (scenario.mode === 'parallel' || scenario.mode === 'file-parallel') {
        options.processPagesInParallel = true;
        options.concurrencyLimit = scenario.concurrencyLimit;
    } else if (scenario.mode === 'worker' || scenario.mode === 'file-worker') {
        options.renderInWorkerThreads = true;
        options.concurrencyLimit = scenario.concurrencyLimit;
    } else if (scenario.mode === 'metadata') {
        options.returnMetadataOnly = true;
    }

    if (isFileMode(scenario.mode)) {
        options.outputFolder = scenario.outputFolder;
        options.outputFileMaskFunc = (pageNumber) => `page-${++outputSequence}-${pageNumber}.png`;
        options.returnPageContent = false;
    }

    return options;
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
    const samples: TimingSample[] = [];
    let pages = 0;

    for (let iteration = 0; iteration < scenario.warmupIterations + scenario.iterations; iteration += 1) {
        if (isFileMode(scenario.mode)) {
            await fsPromises.rm(scenario.outputFolder, { recursive: true, force: true });
        }

        const options = buildOptions(scenario);
        const cpuStart = process.cpuUsage();
        const wallStart = performance.now();
        const result = await pdfToPng(scenario.fixture, options);
        const wallMs = performance.now() - wallStart;
        const cpu = process.cpuUsage(cpuStart);
        pages = result.length;

        if (iteration >= scenario.warmupIterations) {
            samples.push({ wallMs, userCpuMs: cpu.user / 1_000, systemCpuMs: cpu.system / 1_000 });
        }
    }

    if (pages !== scenario.requestedPages) {
        throw new Error(`Expected ${scenario.requestedPages} page result(s), received ${pages}: ${scenario.fixture}`);
    }

    const wallValues = samples.map((sample) => sample.wallMs);
    const userCpuValues = samples.map((sample) => sample.userCpuMs);
    const systemCpuValues = samples.map((sample) => sample.systemCpuMs);
    const cpuValues = samples.map((sample) => sample.userCpuMs + sample.systemCpuMs);
    const peakRssKiB = process.resourceUsage().maxRSS;
    const medianWallMs = median(wallValues);

    return {
        mode: scenario.mode,
        requestedPages: scenario.requestedPages,
        pages,
        iterations: scenario.iterations,
        medianWallMs,
        minWallMs: Math.min(...wallValues),
        meanWallMs: mean(wallValues),
        medianWallMsPerPage: medianWallMs / pages,
        medianCpuMs: median(cpuValues),
        medianUserCpuMs: median(userCpuValues),
        medianSystemCpuMs: median(systemCpuValues),
        peakRssMiB: peakRssKiB / 1_024,
    };
}

function runScenarioInChild(scenario: Scenario): Promise<ScenarioResult> {
    return new Promise((resolveScenario, rejectScenario) => {
        const child = spawn(process.execPath, ['--require', require.resolve('ts-node/register'), __filename], {
            cwd: REPO_ROOT,
            env: { ...process.env, [CHILD_SCENARIO_ENV]: JSON.stringify(scenario) },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });
        child.on('error', rejectScenario);
        child.on('close', (code, signal) => {
            if (code !== 0) {
                rejectScenario(new Error(`Benchmark child failed (${signal ?? `exit ${code}`}):\n${stderr || stdout}`));
                return;
            }

            const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith(CHILD_RESULT_PREFIX));
            if (resultLine === undefined) {
                rejectScenario(new Error(`Benchmark child returned no result:\n${stderr || stdout}`));
                return;
            }
            if (stderr.trim() !== '') process.stderr.write(stderr);
            resolveScenario(JSON.parse(resultLine.slice(CHILD_RESULT_PREFIX.length)) as ScenarioResult);
        });
    });
}

function formatMs(value: number): string {
    return `${value.toFixed(1)} ms`;
}

function formatMiB(value: number): string {
    return `${value.toFixed(1)} MiB`;
}

function printTable(results: ScenarioResult[]): void {
    const header = ['mode', 'requested', 'actual', 'wall median', 'wall/page', 'CPU median', 'process peak RSS'];
    const rows = results.map((result) => [
        result.mode,
        String(result.requestedPages),
        String(result.pages),
        formatMs(result.medianWallMs),
        formatMs(result.medianWallMsPerPage),
        formatMs(result.medianCpuMs),
        formatMiB(result.peakRssMiB),
    ]);
    const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));

    console.log('\n=== End-to-end pdfToPng() ===');
    console.log(header.map((title, column) => title.padEnd(widths[column])).join('  '));
    for (const row of rows) {
        console.log(row.map((cell, column) => cell.padEnd(widths[column])).join('  '));
    }
}

async function runParent(): Promise<void> {
    const config = readConfig();
    await fsPromises.access(config.fixture);
    await fsPromises.rm(TEMP_ROOT, { recursive: true, force: true });
    const fixturePages = (await pdfToPng(config.fixture, { returnMetadataOnly: true })).length;
    if (fixturePages === 0) {
        throw new Error(`Fixture contains no pages: ${config.fixture}`);
    }

    console.log(`pdf-to-png-converter benchmark — ${config.iterations} iterations (+${config.warmupIterations} warmup)`);
    console.log(`node ${process.version}, ${process.platform}/${process.arch}`);
    console.log(`fixture: ${relative(REPO_ROOT, config.fixture) || config.fixture} (${fixturePages} page(s), cycled as needed)`);
    console.log(`pages: ${config.pageCounts.join(', ')}; modes: ${config.modes.join(', ')}; concurrency: ${config.concurrencyLimit}`);

    const scenarios: Scenario[] = config.pageCounts.flatMap((requestedPages) =>
        config.modes.map((mode) => ({
            fixture: config.fixture,
            fixturePages,
            requestedPages,
            mode,
            iterations: config.iterations,
            warmupIterations: config.warmupIterations,
            concurrencyLimit: config.concurrencyLimit,
            outputFolder: join(TEMP_ROOT, `${mode}-${requestedPages}`),
        })),
    );

    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
        const result = await runScenarioInChild(scenario);
        results.push(result);
        console.log(`done: ${result.mode}, ${result.pages} page task(s)`);
    }

    printTable(results);
    await fsPromises.mkdir(RESULTS_ROOT, { recursive: true });
    const resultsPath = join(RESULTS_ROOT, `${config.label}.json`);
    await fsPromises.writeFile(
        resultsPath,
        JSON.stringify(
            {
                label: config.label,
                generatedAt: new Date().toISOString(),
                node: process.version,
                platform: `${process.platform}/${process.arch}`,
                fixture: relative(REPO_ROOT, config.fixture) || config.fixture,
                pageCounts: config.pageCounts,
                modes: config.modes,
                iterations: config.iterations,
                warmupIterations: config.warmupIterations,
                concurrencyLimit: config.concurrencyLimit,
                results,
            },
            null,
            2,
        ),
        'utf8',
    );
    await fsPromises.rm(TEMP_ROOT, { recursive: true, force: true });
    console.log(`\nresults saved: ${resultsPath}`);
}

async function main(): Promise<void> {
    const serializedScenario = process.env[CHILD_SCENARIO_ENV];
    if (serializedScenario !== undefined) {
        const result = await runScenario(JSON.parse(serializedScenario) as Scenario);
        process.stdout.write(`${CHILD_RESULT_PREFIX}${JSON.stringify(result)}\n`);
        return;
    }
    await runParent();
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
