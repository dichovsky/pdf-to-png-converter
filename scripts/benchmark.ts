/**
 * On-demand performance benchmark for pdf-to-png-converter.
 *
 * Usage:
 *   npm run bench                 # all scenarios, 5 timed iterations each (1 warmup)
 *   BENCH_ITERATIONS=3 npm run bench
 *   BENCH_LABEL=baseline npm run bench   # label the saved JSON results file
 *
 * Measures two complementary views on the same machine:
 *  1. End-to-end wall-clock of the public `pdfToPng()` call across realistic scenarios
 *     (sequential vs parallel, buffer vs file output, small vs large documents).
 *  2. A per-stage breakdown (document load / getPage / render / PNG encode) obtained by
 *     driving the internal seams (`getPdfFileBuffer`, `getPdfDocument`, `page.render()`,
 *     `canvas.toBuffer`) directly. The breakdown intentionally re-implements the render
 *     loop of `src/pageRenderer.ts` so each stage can be timed in isolation — it is a
 *     measurement harness, not a second production code path. Its encode stage times the
 *     synchronous `toBuffer('image/png')` twin of the async `encode('png')` used in
 *     production — same native encoder and CPU cost; the async form only moves the work
 *     off the JS thread.
 *
 * Runs against the compiled `out/` build (rebuilt by the npm script) so the numbers reflect
 * exactly what the published package executes. Results are printed as a table and saved as
 * JSON under `bench-results/` (gitignored, survives `npm run clean`) so runs can be diffed.
 */
import { promises as fsPromises } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfToPngOptions } from '../out/index.js';
import { pdfToPng } from '../out/index.js';
import { PDF_TO_PNG_OPTIONS_DEFAULTS } from '../out/const.js';
import { normalizePdfToPngOptions } from '../out/normalizePdfToPngOptions.js';
import { getPdfFileBuffer } from '../out/pdfInput.js';
import { getPdfDocument } from '../out/pdfjsLoader.js';

const REPO_ROOT = resolve(__dirname, '..');
const TEST_DATA = join(REPO_ROOT, 'test-data');
// Everything bench-related lives under bench-results/ (gitignored), NOT test-results/,
// because `npm run bench` rebuilds via `npm run build` whose clean step wipes test-results.
const BENCH_OUTPUT_ROOT = join(REPO_ROOT, 'bench-results', 'tmp');
const RESULTS_DIR = join(REPO_ROOT, 'bench-results');

const ITERATIONS = readIntEnv('BENCH_ITERATIONS', 5, 1);
const WARMUP_ITERATIONS = readIntEnv('BENCH_WARMUP', 1, 0);
const LABEL = process.env.BENCH_LABEL ?? new Date().toISOString().replace(/[:.]/g, '-');

interface Scenario {
    name: string;
    pdfFile: string;
    options: PdfToPngOptions;
}

interface ScenarioResult {
    name: string;
    pages: number;
    iterations: number;
    medianMs: number;
    minMs: number;
    meanMs: number;
    medianMsPerPage: number;
}

interface StageBreakdown {
    pdfFile: string;
    pages: number;
    iterations: number;
    docLoadMs: number;
    getPageMs: number;
    renderMs: number;
    encodeMs: number;
    totalMs: number;
}

function readIntEnv(name: string, fallback: number, min: number): number {
    const raw = process.env[name];
    if (raw === undefined) {
        return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < min) {
        throw new Error(`${name} must be an integer >= ${min}, received: ${raw}`);
    }
    return parsed;
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const SCENARIOS: Scenario[] = [
    {
        name: 'large_pdf (12p) → buffers, sequential',
        pdfFile: join(TEST_DATA, 'large_pdf.pdf'),
        options: { returnPageContent: true },
    },
    {
        name: 'large_pdf (12p) → buffers, parallel(4)',
        pdfFile: join(TEST_DATA, 'large_pdf.pdf'),
        options: { returnPageContent: true, processPagesInParallel: true },
    },
    {
        name: 'large_pdf (12p) → files, sequential',
        pdfFile: join(TEST_DATA, 'large_pdf.pdf'),
        options: { returnPageContent: false, outputFolder: join(BENCH_OUTPUT_ROOT, 'large-seq') },
    },
    {
        name: 'large_pdf (12p) → files, parallel(4)',
        pdfFile: join(TEST_DATA, 'large_pdf.pdf'),
        options: { returnPageContent: false, processPagesInParallel: true, outputFolder: join(BENCH_OUTPUT_ROOT, 'large-par') },
    },
    {
        name: 'sample (2p) → buffers, sequential',
        pdfFile: join(TEST_DATA, 'sample.pdf'),
        options: { returnPageContent: true },
    },
    {
        name: 'TAMReview → buffers, sequential',
        pdfFile: join(TEST_DATA, 'TAMReview.pdf'),
        options: { returnPageContent: true },
    },
];

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
    const timings: number[] = [];
    let pages = 0;

    for (let iteration = 0; iteration < WARMUP_ITERATIONS + ITERATIONS; iteration += 1) {
        // File-output scenarios use exclusive-create writes, so the target folder must be
        // reset between iterations. Done outside the timed region.
        if (scenario.options.outputFolder !== undefined) {
            await fsPromises.rm(scenario.options.outputFolder, { recursive: true, force: true });
        }

        const start = performance.now();
        const result = await pdfToPng(scenario.pdfFile, scenario.options);
        const elapsed = performance.now() - start;

        pages = result.length;
        if (iteration >= WARMUP_ITERATIONS) {
            timings.push(elapsed);
        }
    }

    return {
        name: scenario.name,
        pages,
        iterations: ITERATIONS,
        medianMs: median(timings),
        minMs: Math.min(...timings),
        meanMs: mean(timings),
        medianMsPerPage: median(timings) / pages,
    };
}

/** Minimal structural view of pdf.js's Node canvas factory (see src/pageRenderer.ts). */
interface BenchCanvasFactory {
    create(
        width: number,
        height: number,
    ): {
        canvas: { toBuffer(mime: 'image/png'): Buffer } | null;
        context: unknown;
    };
    destroy(canvasAndContext: unknown): void;
}

async function runStageBreakdown(pdfFile: string): Promise<StageBreakdown> {
    const normalized = normalizePdfToPngOptions({ returnPageContent: true });
    const stageSums = { docLoadMs: 0, getPageMs: 0, renderMs: 0, encodeMs: 0 };
    let pages = 0;

    for (let iteration = 0; iteration < WARMUP_ITERATIONS + ITERATIONS; iteration += 1) {
        const timed = iteration >= WARMUP_ITERATIONS;
        const buffer = await getPdfFileBuffer(pdfFile, PDF_TO_PNG_OPTIONS_DEFAULTS.maxInputBytes);

        const docLoadStart = performance.now();
        const pdfDocument: PDFDocumentProxy = await getPdfDocument(buffer, normalized);
        if (timed) {
            stageSums.docLoadMs += performance.now() - docLoadStart;
        }

        try {
            pages = pdfDocument.numPages;
            const canvasFactory = pdfDocument.canvasFactory as unknown as BenchCanvasFactory;

            for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
                const getPageStart = performance.now();
                const page = await pdfDocument.getPage(pageNumber);
                const viewport = page.getViewport({ scale: normalized.viewportScale });
                if (timed) {
                    stageSums.getPageMs += performance.now() - getPageStart;
                }

                const canvasAndContext = canvasFactory.create(Math.floor(viewport.width), Math.floor(viewport.height));
                try {
                    const renderStart = performance.now();
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore — same DOM-vs-SKRS context mismatch as src/pageRenderer.ts
                    await page.render({ canvasContext: canvasAndContext.context, viewport, canvas: canvasAndContext.canvas }).promise;
                    if (timed) {
                        stageSums.renderMs += performance.now() - renderStart;
                    }

                    const encodeStart = performance.now();
                    canvasAndContext.canvas?.toBuffer('image/png');
                    if (timed) {
                        stageSums.encodeMs += performance.now() - encodeStart;
                    }
                } finally {
                    page.cleanup();
                    canvasFactory.destroy(canvasAndContext);
                }
            }
        } finally {
            await pdfDocument.loadingTask.destroy();
        }
    }

    const totalMs = stageSums.docLoadMs + stageSums.getPageMs + stageSums.renderMs + stageSums.encodeMs;
    return {
        pdfFile,
        pages,
        iterations: ITERATIONS,
        docLoadMs: stageSums.docLoadMs / ITERATIONS,
        getPageMs: stageSums.getPageMs / ITERATIONS,
        renderMs: stageSums.renderMs / ITERATIONS,
        encodeMs: stageSums.encodeMs / ITERATIONS,
        totalMs: totalMs / ITERATIONS,
    };
}

function formatMs(value: number): string {
    return `${value.toFixed(1)} ms`;
}

function printScenarioTable(results: ScenarioResult[]): void {
    console.log('\n=== End-to-end pdfToPng() ===');
    const header = ['scenario', 'pages', 'median', 'min', 'mean', 'median/page'];
    const rows = results.map((result) => [
        result.name,
        String(result.pages),
        formatMs(result.medianMs),
        formatMs(result.minMs),
        formatMs(result.meanMs),
        formatMs(result.medianMsPerPage),
    ]);
    const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
    console.log(header.map((title, column) => title.padEnd(widths[column])).join('  '));
    for (const row of rows) {
        console.log(row.map((cell, column) => cell.padEnd(widths[column])).join('  '));
    }
}

function printStageBreakdown(breakdown: StageBreakdown): void {
    console.log(`\n=== Stage breakdown: ${breakdown.pdfFile} (${breakdown.pages} pages, mean per conversion) ===`);
    const stages: Array<[string, number]> = [
        ['document load', breakdown.docLoadMs],
        ['getPage+viewport', breakdown.getPageMs],
        ['render', breakdown.renderMs],
        ['PNG encode', breakdown.encodeMs],
    ];
    for (const [stage, ms] of stages) {
        const share = breakdown.totalMs > 0 ? ((ms / breakdown.totalMs) * 100).toFixed(1) : '0.0';
        console.log(`${stage.padEnd(18)} ${formatMs(ms).padStart(11)}  (${share}%)`);
    }
    console.log(`${'total'.padEnd(18)} ${formatMs(breakdown.totalMs).padStart(11)}`);
}

async function main(): Promise<void> {
    console.log(`pdf-to-png-converter benchmark — ${ITERATIONS} iterations (+${WARMUP_ITERATIONS} warmup), label: ${LABEL}`);
    console.log(`node ${process.version}, ${process.platform}/${process.arch}`);

    const scenarioResults: ScenarioResult[] = [];
    for (const scenario of SCENARIOS) {
        scenarioResults.push(await runScenario(scenario));
        console.log(`done: ${scenario.name}`);
    }

    const breakdowns: StageBreakdown[] = [];
    for (const pdfName of ['large_pdf.pdf', 'TAMReview.pdf', 'sample.pdf']) {
        breakdowns.push(await runStageBreakdown(join(TEST_DATA, pdfName)));
    }

    printScenarioTable(scenarioResults);
    for (const breakdown of breakdowns) {
        printStageBreakdown(breakdown);
    }

    await fsPromises.mkdir(RESULTS_DIR, { recursive: true });
    const resultsPath = join(RESULTS_DIR, `${LABEL}.json`);
    await fsPromises.writeFile(
        resultsPath,
        JSON.stringify(
            {
                label: LABEL,
                node: process.version,
                platform: `${process.platform}/${process.arch}`,
                iterations: ITERATIONS,
                warmupIterations: WARMUP_ITERATIONS,
                scenarios: scenarioResults,
                stageBreakdowns: breakdowns,
            },
            null,
            2,
        ),
    );
    console.log(`\nresults saved: ${resultsPath}`);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
