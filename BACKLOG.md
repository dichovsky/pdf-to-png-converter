# Architecture Review Backlog

This backlog captures architectural, typing, maintainability, reliability, performance, and security findings from a deep review of the current TypeScript codebase.

> **Release status:** All backlog items below shipped in **v4.0.0**. This file is retained as the implementation record for that release.

> **AI-agent execution notes (apply to every item below)**
>
> These items are intended to be implemented by an AI coding agent. The following ground rules apply across all items and should be treated as hard constraints:
>
> - Every acceptance criterion must be verifiable by running `npm test`, `npm run lint`, or `npm run build:test`. Do not add acceptance criteria that require human judgment or review gates.
> - Replace all "consider", "evaluate", and "investigate" language with a committed decision and a concrete action.
> - Name the exact source files, exported functions, and (where possible) line numbers where each change starts.
> - For breaking API changes, state the semver impact (`major` / `minor` / `patch`) explicitly; the agent must update `CHANGELOG.md` and `README.md` accordingly.
> - Decompose any item that touches more than three files simultaneously into sub-items before assigning it.
> - Do not add estimation language (story points, hours, T-shirt sizes).
> - Preserve the "Technical rationale" sections — the agent uses them to make locally correct decisions when the spec is underspecified.

---

## P1

### [x] ARCH-001 Fix absolute `outputFolder` resolution

- **Problem:** In `src/pdfToPng.ts` (line 142), `resolvedOutputFolder` is built with `join(process.cwd(), props.outputFolder)`. This silently rewrites absolute paths under `process.cwd()`, breaking the documented contract that `outputFolder` may be relative or absolute.
- **Technical rationale:** This is a correctness bug. It can write files to the wrong location and makes behavior depend on an implementation detail of `path.join()`.
- **Implementation direction:**
    1. On line 142 of `src/pdfToPng.ts`, replace `join(process.cwd(), props.outputFolder)` with `resolve(props.outputFolder)`. The `resolve` import already exists on line 2 of that file — no new import is needed.
    2. Update the JSDoc comment on `savePNGfile` (currently around line 444) that says "caller already computed via `join(cwd, props.outputFolder)`" to reflect the change to `resolve()`.
    3. Do not change any other call sites — `resolvedOutputFolder` is consumed only by `fsPromises.mkdir`, `fsPromises.realpath`, and `processAndSavePage → savePNGfile`, all of which accept an absolute path.
- **Acceptance criteria:**
    1. `await pdfToPng('test-data/large_pdf.pdf', { outputFolder: '/tmp/absolute-out' })` writes files to `/tmp/absolute-out/` exactly, not to `<cwd>/tmp/absolute-out/`.
    2. `await pdfToPng('test-data/large_pdf.pdf', { outputFolder: 'relative-out' })` still writes to `<cwd>/relative-out/`.
    3. A new test in `__tests__/pdf.to.png.absolute.output.folder.test.ts` covers both cases and passes.
    4. `npm test` passes with no changes to any other source file.

### [x] ARCH-002 Introduce a single option normalization and validation layer

- **Problem:** Validation and defaulting are split across `src/cli.ts` (lines 155–200) and `src/pdfToPng.ts` (lines 108–127), leaving gaps: `pagesToProcess` accepts `0` and negative numbers, `verbosityLevel` accepts any integer, and `outputFolder: ''` silently resolves to `process.cwd()`.
- **Technical rationale:** A single normalization boundary reduces duplicated rules, makes behavior consistent across API and CLI entry points, and creates a stable seam for testing.
- **Implementation direction:**
    1. Create `src/normalizePdfToPngOptions.ts`. Export one function: `normalizePdfToPngOptions(props: PdfToPngOptions | undefined): NormalizedPdfToPngOptions`. Define the internal `NormalizedPdfToPngOptions` interface in the same file — do not add it to the public `src/index.ts` barrel.
    2. Move the `viewportScale` validation block (lines 108–118 of `src/pdfToPng.ts`) and the `concurrencyLimit` validation block (lines 122–127) into `normalizePdfToPngOptions`.
    3. Add to `normalizePdfToPngOptions`: throw `Error('outputFolder must not be empty')` when `outputFolder` is `''` or whitespace-only; throw `Error('verbosityLevel must be 0, 1, or 5')` for any value not in `{0, 1, 5}`; throw `Error('pagesToProcess contains invalid page number: <n>')` for any entry `<= 0`.
    4. In `pdfToPng()`, call `normalizePdfToPngOptions(props)` immediately after the function signature and replace all subsequent `props?.xxx ?? PDF_TO_PNG_OPTIONS_DEFAULTS.xxx` expressions with references to the returned normalized object.
    5. In `src/cli.ts`, the `run()` function's numeric-validation blocks (lines 155–200) may be simplified to delegate to `normalizePdfToPngOptions` — or left as-is if they produce clearer CLI error messages; either is acceptable.
- **Acceptance criteria:**
    1. `normalizePdfToPngOptions({ outputFolder: '' })` throws synchronously before any I/O.
    2. `normalizePdfToPngOptions({ verbosityLevel: 3 })` throws.
    3. `normalizePdfToPngOptions({ pagesToProcess: [0] })` throws; `normalizePdfToPngOptions({ pagesToProcess: [-1] })` throws.
    4. `normalizePdfToPngOptions({ verbosityLevel: 0 })`, `normalizePdfToPngOptions({ verbosityLevel: 1 })`, and `normalizePdfToPngOptions({ verbosityLevel: 5 })` do not throw.
    5. A new test file `__tests__/normalize.pdf.to.png.options.test.ts` covers all branches above plus the happy-path case where all defaults are applied correctly.
    6. `npm test` and `npm run lint` pass.

### [x] ARCH-003 Split `src/pdfToPng.ts` into composable modules

- **Problem:** At ~490 lines, `src/pdfToPng.ts` simultaneously owns input loading, pdfjs bootstrap, render orchestration, filename generation, parallel batching, file writing, path security, and cleanup.
- **Technical rationale:** This concentration prevents isolated unit testing of any single responsibility and will slow additions of new output sinks, alternative renderers, or stronger isolation tests.
- **Implementation direction — use these exact file names:**

    | New file                  | Extracted from `pdfToPng.ts`                 | Contents                                    |
    | ------------------------- | -------------------------------------------- | ------------------------------------------- |
    | `src/pdfInput.ts`         | `getPdfFileBuffer()`                         | File read + Buffer normalisation            |
    | `src/pdfjsLoader.ts`      | `getPdfDocument()` + `let pdfjsLib` cache    | Dynamic pdfjs import, document creation     |
    | `src/pageRenderer.ts`     | `renderPdfPage()` + `getPageMetadata()`      | Canvas creation, render, metadata-only path |
    | `src/outputWriter.ts`     | `savePNGfile()` + `isEscapingRelativePath()` | File write + path-containment checks        |
    | `src/pageOrchestrator.ts` | `processAndSavePage()` + `resolvePageName()` | Per-page coordination, name resolution      |

    After extraction, `src/pdfToPng.ts` retains only `pdfToPng()` (~50 lines) and imports from the modules above. All imports must use `.js` extensions (e.g. `import { getPdfFileBuffer } from './pdfInput.js'`).

- **Acceptance criteria:**
    1. `src/pdfToPng.ts` is under 80 lines after the split.
    2. All five new files exist with the exact names in the table above.
    3. `npm run build:test` passes with no type errors.
    4. `npm run lint` passes with no new suppressions.
    5. All existing tests pass without modification — this is a pure refactor; no test file may be changed.

### [x] ARCH-004 Harden file writes against symlink and TOCTOU races

- **Problem:** `savePNGfile()` (lines 437–479 of `src/pdfToPng.ts`) ends with `fsPromises.writeFile()`, which follows symlinks at the target filename, defeating the containment model that the preceding checks establish.
- **Technical rationale:** The containment checks are strong, but the final write can still be redirected by a symlink planted at the output filename before the write. `fsPromises.open` with exclusive-create flags blocks this on POSIX systems.
- **Implementation direction:**
    1. In `savePNGfile` (line 479), replace `await fsPromises.writeFile(pngPageOutput.path, pngPageOutput.content as Buffer)` with an fd-based write using the `'wx'` flag (`O_WRONLY | O_CREAT | O_EXCL`), which fails with `EEXIST` if the target path exists — including if it is a symlink — on POSIX:
        ```ts
        const fd = await fsPromises.open(pngPageOutput.path, 'wx');
        try {
            await fd.writeFile(pngPageOutput.content as Buffer);
        } finally {
            await fd.close();
        }
        ```
    2. Update the JSDoc on `savePNGfile` to document that `'wx'` prevents overwriting existing files and that callers should clear the output folder between runs if re-running the same conversion.
    3. Update the TOCTOU limitation comment in the JSDoc to reflect the improved guarantee.
- **Acceptance criteria:**
    1. `savePNGfile` no longer calls `fsPromises.writeFile` directly — `grep -n 'writeFile' src/pdfToPng.ts` must return zero results for a top-level `writeFile` call (or check `src/outputWriter.ts` if ARCH-003 landed first).
    2. A new test in `__tests__/security.path.test.ts` creates a symlink at the target filename path before calling the function under test and asserts the call throws `EEXIST`.
    3. All existing integration tests that write files to disk pass unchanged.
    4. `npm test` passes.

---

## P2

### [x] TYPE-001 Replace ambiguous output shapes with discriminated result types

- **Semver impact:** `major` — `PngPageOutput` is a public type; callers that access `.content` or `.path` without a `kind` guard will require updates.
- **Problem:** `PngPageOutput` represents three modes at once — metadata-only, in-memory render, and rendered-to-disk — forcing consumers to infer validity from `content?: Buffer` and the sentinel `path: ''`.
- **Technical rationale:** The current shape hides invariants instead of expressing them, pushing correctness into documentation and consumer guesswork.
- **Implementation direction:**
    1. In `src/interfaces/png.page.output.ts`, replace the single interface with:
        ```ts
        interface BasePngPageOutput {
            pageNumber: number;
            name: string;
            width: number;
            height: number;
            rotation: number;
        }
        export interface MetadataPngPageOutput extends BasePngPageOutput {
            kind: 'metadata';
            content: undefined;
            path: '';
        }
        export interface InMemoryPngPageOutput extends BasePngPageOutput {
            kind: 'content';
            content: Buffer;
            path: '';
        }
        export interface FilePngPageOutput extends BasePngPageOutput {
            kind: 'file';
            content: Buffer | undefined;
            path: string;
        }
        export type PngPageOutput = MetadataPngPageOutput | InMemoryPngPageOutput | FilePngPageOutput;
        ```
    2. Update `src/interfaces/index.ts` to re-export all four new names.
    3. In `src/pdfToPng.ts` (or extracted modules if ARCH-003 landed first), set `kind` explicitly in every `PngPageOutput` construction site: `getPageMetadata` returns `MetadataPngPageOutput`, `renderPdfPage` returns `InMemoryPngPageOutput`, the post-write path in `processAndSavePage` returns `FilePngPageOutput`.
    4. Update `CHANGELOG.md` with a new section noting the breaking change. Update `README.md` examples that reference `PngPageOutput.content` or `PngPageOutput.path` to branch on `kind` first.
- **Acceptance criteria:**
    1. `npm run build:test` passes — the compiler enforces the discriminated union at every call site.
    2. Accessing `.content` on a `MetadataPngPageOutput` without narrowing on `kind` is a compile-time error.
    3. A new test compiles and passes using `if (page.kind === 'file') { page.path; }` without any type assertion.
    4. `CHANGELOG.md` and `README.md` are updated.
    5. `npm test` passes.

### [x] ARCH-005 Remove hidden mutation from the page processing pipeline

- **Problem:** `savePNGfile()` mutates `pngPageOutput.path` (line 461 of `src/pdfToPng.ts`) and `processAndSavePage()` mutates `pageOutput.content = undefined` (line 99). These are hidden side effects on objects created elsewhere.
- **Technical rationale:** Hidden mutation makes object lifecycle non-obvious, complicates debugging, and makes refactors riskier.
- **Implementation direction:**
    1. Change `savePNGfile` from `Promise<void>` to `Promise<string>` — remove the `pngPageOutput.path = resolvedFilePath` mutation and instead `return resolvedFilePath` at the end.
    2. In `processAndSavePage`, after `await savePNGfile(pageOutput, ...)`, construct and return a new object:
        ```ts
        return { ...pageOutput, path: resolvedPath, content: returnPageContent === false ? undefined : pageOutput.content };
        ```
        Do not assign to `pageOutput.path` or `pageOutput.content`.
    3. If TYPE-001 is implemented first, the `FilePngPageOutput` construction naturally forces a new object; steps 1–2 are then redundant and may be skipped.
- **Acceptance criteria:**
    1. `savePNGfile` signature returns `Promise<string>`, not `Promise<void>`.
    2. `grep -n 'pageOutput\.' src/pdfToPng.ts` (or the relevant extracted module) returns zero assignment expressions on `pageOutput` fields after the initial object construction.
    3. `npm test` passes.

### [x] TYPE-002 Eliminate unsafe assertions and non-null casts

- **Problem:** `src/pdfToPng.ts` uses `pdfFile as Buffer` (line 263), `pdf.canvasFactory as NodeCanvasFactory` (line 372), `canvas!` (line 380), and `pngPageOutput.content as Buffer` (line 479).
- **Technical rationale:** These casts bypass the type system at process, filesystem, and external-library boundaries — the places where runtime surprises are most likely.
- **Implementation direction — per-cast fix:**
    1. **`pdfFile as Buffer` (line 263):** The `Buffer.isBuffer(pdfFile)` guard on line 262 already narrows the type in the true branch. Remove the `as Buffer` cast — it is redundant.
    2. **`pdf.canvasFactory as NodeCanvasFactory` (line 372):** Add a local type guard `function isNodeCanvasFactory(f: unknown): f is NodeCanvasFactory { return typeof (f as NodeCanvasFactory)?.create === 'function'; }` and replace the cast with `isNodeCanvasFactory(pdf.canvasFactory) ? pdf.canvasFactory : new NodeCanvasFactory()`.
    3. **`canvas!` (line 380):** Immediately after `canvasFactory.create(...)`, add `if (!canvas) throw new Error('NodeCanvasFactory.create returned a null canvas')` and remove the `!` assertion.
    4. **`pngPageOutput.content as Buffer` (line 479):** Add `if (!Buffer.isBuffer(pngPageOutput.content)) throw new Error(...)` immediately before the write call and remove the cast.
- **Acceptance criteria:**
    1. `grep -n ' as ' src/pdfToPng.ts` returns zero results for the four casts listed above.
    2. `grep -n '!' src/pdfToPng.ts` returns zero results for non-null assertions on runtime values.
    3. `npm run lint` and `npm test` pass.

### [x] ARCH-006 Manage PDF.js lifecycle explicitly, including `destroy()`

- **Problem:** `pdfToPng()` calls `pdfDocument.cleanup()` in `finally` (line 203) but never calls `pdfDocument.destroy()`. The `getDocument()` loading task is discarded without teardown on error paths.
- **Technical rationale:** `cleanup()` clears cached render resources; `destroy()` terminates the document and worker transport. Omitting `destroy()` can retain memory and worker threads between calls.
- **Implementation direction:**
    1. In `src/pdfToPng.ts` line 203, change `await pdfDocument.cleanup()` to `await pdfDocument.destroy()`. `destroy()` internally calls `cleanup()` — no separate `cleanup()` call is needed.
    2. In `getPdfDocument()`, store the `PDFDocumentLoadingTask` returned by `pdfjsLib.getDocument(...)` in a `const task` variable. Wrap `.promise` in a try/catch: if `.promise` rejects, call `await task.destroy()` in the catch before re-throwing.
    3. Add a unit test that mocks `page.render` to reject and asserts that `pdfDocument.destroy()` is called (use `vi.spyOn`).
- **Acceptance criteria:**
    1. `grep -n 'cleanup' src/pdfToPng.ts` returns zero results in the `finally` block — `destroy()` is used instead.
    2. A new test covering the render-failure path asserts `destroy()` was called.
    3. `npm test` passes.

### [x] ARCH-007 Make the CLI a thin adapter over a reusable execution API

- **Problem:** `run()` in `src/cli.ts` is ~134 lines mixing `parseArgs`, numeric validation, boolean parsing, options assembly, logging, error formatting, and `process.exit()`.
- **Technical rationale:** Mixing these concerns makes CLI behavior hard to test without mocking `process.exit()` and prevents reuse of the execution logic.
- **Implementation direction:**
    1. Extract `buildPdfToPngOptions(values: ParsedValues, positionals: string[]): { pdfFilePath: string } & PdfToPngOptions` — a pure function covering approximately lines 144–224 of the current `run()`.
    2. Extract `executeConversion(pdfFilePath: string, options: PdfToPngOptions, log: (...msgs: unknown[]) => void): Promise<void>` — wraps the `try/catch` block at lines 231–244.
    3. `run()` becomes: call `parseArgs` → call `buildPdfToPngOptions` → call `executeConversion` → call `process.exit`. Target under 35 lines.
    4. `buildPdfToPngOptions` should call `normalizePdfToPngOptions` from ARCH-002 where possible.
- **Acceptance criteria:**
    1. `run()` function body is under 35 lines after the extraction.
    2. Tests for `buildPdfToPngOptions` do not mock `process.exit`.
    3. `npm test` passes including all existing CLI tests.
    4. `npm run build:test` and `npm run lint` pass.

### [x] ARCH-008 Confirm and document the CJS-only module packaging strategy

- **Problem:** The package mixes `"type": "commonjs"`, `nodenext` TypeScript module resolution, and `.js` import specifiers in source, but lacks a contract test asserting the published `require()` / `import` surface.
- **Technical rationale:** The packaging is already consistent (CJS-only), but without a contract test, a future change to `package.json` or `tsconfig.prod.json` could silently break consumers.
- **Decision (CJS-only; do not add a dual-publish build):** The existing `exports` map and `"type": "commonjs"` are correct. The only actions needed are to add a contract test and a clarifying comment.
- **Implementation direction:**
    1. Create `__tests__/exports.contract.test.ts`. Import `pdfToPng` and `VerbosityLevel` from `'../src/index.js'` and assert both are defined (truthy).
    2. Add a `"_packageFormatNote"` key to `package.json`: `"_packageFormatNote": "CJS-only — nodenext TS with .js specifiers is compatible."`.
    3. Verify `README.md` import examples use `import { pdfToPng } from 'pdf-to-png-converter'` without a path that requires ESM interop.
- **Acceptance criteria:**
    1. `__tests__/exports.contract.test.ts` exists and passes.
    2. `npm test` passes.

### [x] TYPE-003 Strengthen public option and metadata types

- **Problem:** `verbosityLevel?: number` accepts any integer, `pagesToProcess?: number[]` accepts any number, and `rotation: number` is wider than the four valid PDF rotation values.
- **Technical rationale:** Weak public types reduce IDE guidance and allow invalid values to flow further into the system.
- **Implementation direction:**
    1. In `src/interfaces/pdf.to.png.options.ts`, change `verbosityLevel?: number` to `verbosityLevel?: VerbosityLevel`. Add `import type { VerbosityLevel } from '../types/index.js'` at the top of the file.
    2. In `src/interfaces/png.page.output.ts`, change `rotation: number` to `rotation: 0 | 90 | 180 | 270`.
    3. In `src/pdfToPng.ts`, add a helper `normalizeRotation(raw: number): 0 | 90 | 180 | 270` that computes `(((raw % 360) + 360) % 360)` and asserts the result is in `{0, 90, 180, 270}`. Call it in both `getPageMetadata` and `renderPdfPage` when setting `rotation`.
    4. Add a unit test for `normalizeRotation`: `normalizeRotation(0) === 0`, `normalizeRotation(270) === 270`, `normalizeRotation(-90) === 270`, `normalizeRotation(360) === 0`.
- **Acceptance criteria:**
    1. `npm run build:test` passes — all call sites of `rotation` receive the narrowed type.
    2. `verbosityLevel: 3` passed to `pdfToPng()` is caught by ARCH-002's validation before reaching pdfjs.
    3. The `normalizeRotation` unit test passes.
    4. `npm run lint` passes.

### [x] PERF-001a Output-sink abstraction (prerequisite for PERF-001b)

- **Problem:** Rendering is tightly coupled to in-memory `Buffer` retention. There is no way to write page output directly to disk without first building a full in-memory PNG buffer.
- **Technical rationale:** Decoupling rendering from the output sink is the prerequisite for any memory or scheduling improvement.
- **Implementation direction:**
    1. Create `src/interfaces/output.sink.ts` with:
        ```ts
        export interface OutputSink {
            write(name: string, content: Buffer): Promise<string>;
        }
        ```
    2. Create `src/filesystemSink.ts` implementing `OutputSink` — wraps the current `savePNGfile` logic.
    3. Create `src/nullSink.ts` implementing `OutputSink` — returns `''` and discards the buffer (used when only in-memory content is needed).
    4. In `processAndSavePage`, replace the `if (resolvedOutputFolder !== undefined …)` branch with a call to the injected sink.
- **Acceptance criteria:**
    1. `npm test` passes with no behavior change observable from existing tests.
    2. `npm run build:test` and `npm run lint` pass.
    3. `src/interfaces/output.sink.ts`, `src/filesystemSink.ts`, and `src/nullSink.ts` all exist.

### [x] PERF-001b Sliding-window page scheduler (depends on PERF-001a)

- **Problem:** The parallel render loop (lines 166–184 of `src/pdfToPng.ts`) uses lock-step `Promise.all` chunking: page 3 does not start until pages 1 and 2 both finish, leaving concurrency slots idle when one page finishes early.
- **Technical rationale:** A sliding-window scheduler keeps exactly `concurrencyLimit` tasks active, improving throughput on documents with variable-duration pages.
- **Implementation direction:**
    1. Replace the `for` + `Promise.all` batch loop with a sliding-window implementation using only `Promise` and an index counter — do not add any new npm dependency.
    2. The replacement must maintain document order in the returned `PngPageOutput[]` array.
- **Acceptance criteria:**
    1. A new test with `concurrencyLimit: 2` and 5 pages asserts that page 3 starts as soon as page 1 or 2 completes (not after both complete). Use `vi.spyOn` on the render function to track start order.
    2. All existing parallel-mode tests pass unchanged.
    3. `npm test` passes.

### [x] TEST-001 Expand contract and security tests

- **Problem:** The test suite is strong on integration render scenarios but lacks contract tests for option normalization, absolute path handling, and adversarial filename/symlink cases.
- **Technical rationale:** Architectural regressions happen at boundaries. Contract tests are cheaper and faster than render-based integration tests.
- **Implementation direction — implement all rows in this table in `__tests__/security.path.test.ts`:**

    | Input                                                    | Expected behavior                                                          |
    | -------------------------------------------------------- | -------------------------------------------------------------------------- |
    | `outputFolder: '../escape'`                              | Does not throw (folder path is allowed; containment is per filename)       |
    | `outputFileMaskFunc: () => '../escape.png'`              | `savePNGfile` throws `"Output file name escapes the output folder"`        |
    | `outputFileMaskFunc: () => '/etc/passwd'`                | `savePNGfile` throws (absolute filename)                                   |
    | `outputFileMaskFunc: () => ''`                           | `resolvePageName` throws `"outputFileMaskFunc returned an empty filename"` |
    | `outputFolder: ''`                                       | After ARCH-002: throws before I/O                                          |
    | `pagesToProcess: [0]`                                    | After ARCH-002: throws before I/O                                          |
    | `pagesToProcess: [-1]`                                   | After ARCH-002: throws before I/O                                          |
    | `pagesToProcess: [999999]`                               | Silently filtered; returns `[]`                                            |
    | `verbosityLevel: 3`                                      | After ARCH-002: throws before I/O                                          |
    | Target path is a symlink pointing outside `outputFolder` | `savePNGfile` throws (use `fsPromises.symlink` in test setup)              |

    Each table row maps to exactly one `test()` call. Tests that depend on ARCH-001/002/004 may be marked `test.skip` until those items land; add a `// depends on: ARCH-NNN` comment.

- **Acceptance criteria:**
    1. All ten table rows have a corresponding `test()` in `__tests__/security.path.test.ts`.
    2. `npm test` passes.

---

## P3

### [x] CLI-001 Stop silently swallowing `getVersion()` failures

- **Problem:** `getVersion()` in `src/cli.ts` (lines 94–102) catches all errors and returns `'Unknown'`, masking packaging defects.
- **Technical rationale:** A missing or malformed `package.json` is a packaging bug, not an expected runtime condition. Hiding it delays diagnosis.
- **Implementation direction:**
    1. Change `getVersion()` to throw `Error('Cannot determine package version: package.json missing or malformed')` instead of returning `'Unknown'` when `package.json` is absent or has no `version` field.
    2. In `run()`, wrap the `console.log(\`v${getVersion()}\`)`call in a`try/catch`that calls`console.error(err.message)`and`process.exit(1)` on failure.
    3. Update the `getVersion()` unit test to assert the throw for a missing file and a missing `version` field.
- **Acceptance criteria:**
    1. `getVersion()` throws when `package.json` is absent — asserted by a unit test using `vi.mock('node:fs')`.
    2. `--version` from a correctly packaged build still outputs the correct semver string.
    3. `npm test` passes.

### [x] DX-001 Add a stricter type-check job for release validation

- **Problem:** `tsconfig.json` uses `skipLibCheck: true`, which hides incompatibilities at external type boundaries (`pdfjs-dist`, `@napi-rs/canvas`).
- **Technical rationale:** The project's correctness depends on these third-party adapters. Suppressing upstream type issues weakens confidence at the most important integration points.
- **Decision (do not set `skipLibCheck: false` in the main tsconfig):** `pdfjs-dist` is known to have type issues. Instead, add a separate config for release-time stricter checking.
- **Implementation direction:**
    1. Create `tsconfig.strict.json` at the repo root:
        ```json
        {
            "extends": "./tsconfig.json",
            "compilerOptions": { "skipLibCheck": false, "noEmit": true }
        }
        ```
    2. Add a `"build:strict"` script to `package.json`: `"build:strict": "tsc --project tsconfig.strict.json || true"`.
    3. In `.github/workflows/test.yml`, add a step after the existing lint step: `run: npm run build:strict`, marked `continue-on-error: true` so it reports failures without blocking the build. Remove `continue-on-error` when all errors are resolved.
    4. For any errors that surface, add a `// @ts-ignore — upstream <package>@<version> type gap` comment at the specific import site in `src/` (not a global suppression).
- **Acceptance criteria:**
    1. `tsconfig.strict.json` exists at the repo root.
    2. `npm run build:strict` runs without a script error (exit 0 or `|| true`).
    3. `.github/workflows/test.yml` includes the `build:strict` step.
    4. `npm test` passes unchanged.
