# Architecture Review Backlog

This backlog captures architectural, typing, maintainability, reliability, performance, and security findings from a deep review of the current TypeScript codebase.

## P1

### [ ] ARCH-001 Fix absolute `outputFolder` resolution
- **Problem:** `src/pdfToPng.ts` builds `resolvedOutputFolder` with `join(process.cwd(), props.outputFolder)`. This breaks the documented contract that `outputFolder` may be relative or absolute, because absolute inputs are rewritten under the current working directory instead of being preserved.
- **Technical rationale:** This is a correctness bug, not a cosmetic issue. It can silently write files to the wrong location and makes the API behavior depend on an implementation detail of `path.join()`.
- **Implementation direction:**
  1. Replace `join(process.cwd(), props.outputFolder)` with `resolve(props.outputFolder)` or an explicit `isAbsolute()` branch.
  2. Normalize the resolved path once and pass the canonical absolute path through the pipeline.
  3. Update any path-security logic that assumes the current implementation.
- **Acceptance criteria:**
  1. Passing a relative `outputFolder` still resolves from `process.cwd()`.
  2. Passing an absolute `outputFolder` writes to that exact directory.
  3. Add tests covering both relative and absolute destinations.

### [ ] ARCH-002 Introduce a single option normalization and validation layer
- **Problem:** Validation and defaulting are split across `src/cli.ts`, `src/pdfToPng.ts`, and documentation. This creates drift and leaves gaps such as weak validation for `pagesToProcess`, `verbosityLevel`, and `outputFolder`.
- **Technical rationale:** A single normalization boundary reduces duplicated rules, makes behavior consistent across API and CLI entry points, and creates a stable seam for testing.
- **Implementation direction:**
  1. Add `normalizePdfToPngOptions()` that accepts raw API/CLI options and returns a canonical, fully validated object.
  2. Move defaults from ad hoc `??` expressions into that function.
  3. Reject invalid values early: empty `outputFolder`, non-integer page numbers, unsupported verbosity values, invalid filenames, invalid concurrency.
  4. Reuse this normalization in both `pdfToPng()` and the CLI execution path.
- **Acceptance criteria:**
  1. API and CLI share the same normalized option semantics.
  2. Invalid options fail before I/O begins.
  3. Normalization has focused unit tests that cover each option branch.

### [ ] ARCH-003 Split `src/pdfToPng.ts` into composable modules
- **Problem:** `src/pdfToPng.ts` currently mixes input loading, pdfjs bootstrap, render orchestration, filename generation, parallel batching, file writing, path security, and cleanup in one module.
- **Technical rationale:** The file has become the system’s orchestration layer, adapter layer, and infrastructure layer at the same time. That concentration will slow future work such as adding new output sinks, alternative renderers, or stronger isolation tests.
- **Implementation direction:**
  1. Extract input handling into a dedicated module such as `src/io/input.ts` or `pdfInput.ts` for `getPdfFileBuffer()` and normalization logic.
  2. Extract PDF lifecycle management into `src/pdf/document.ts`, `pdfDocumentLoader.ts`, or `pdfjsAdapter.ts` for pdfjs loading, caching, and teardown.
  3. Extract rendering into `src/render/renderer.ts` or `pageRenderer.ts` for metadata-only and full-render logic.
  4. Extract storage and security into `src/io/storage.ts`, `outputWriter.ts`, and `pathGuards.ts` for filesystem behavior and path-containment checks.
  5. Extract page-loop and concurrency coordination into `src/orchestration/conversion.ts`.
  6. Keep `pdfToPng()` as a thin orchestrator over those modules.
- **Acceptance criteria:**
  1. No single module owns validation, rendering, persistence, and security checks simultaneously.
  2. Private helpers become unit-testable without mocking the full pipeline.
  3. `pdfToPng.ts` is reduced to orchestration and high-level flow.

### [ ] ARCH-004 Harden file writes against symlink and TOCTOU races
- **Problem:** `savePNGfile()` performs containment checks and documents the remaining race window, but still finishes with `fsPromises.writeFile()`, which can follow symlinks and cannot fully guarantee containment.
- **Technical rationale:** The current implementation is better than no guard, but it remains vulnerable on multi-user or shared filesystems. Security-sensitive logic should not end in an API that defeats the containment model.
- **Implementation direction:**
  1. Replace `writeFile()` with an fd-based write flow that minimizes follow/swap risk.
  2. Use exclusive creation and, where supported, no-follow semantics.
  3. Consider a write-to-temp-then-rename flow inside the validated directory.
  4. Document any unavoidable OS portability limitations in one place instead of inside the main render flow.
- **Acceptance criteria:**
  1. The write path no longer depends on `writeFile()` directly.
  2. Security tests cover symlink escapes and directory swap attempts as far as the platform allows.
  3. The containment model is centralized and documented in one module.

## P2

### [ ] TYPE-001 Replace ambiguous output shapes with discriminated result types
- **Problem:** `PngPageOutput` represents multiple modes at once: metadata-only, in-memory render, and rendered-to-disk. Consumers must infer validity from `content?: Buffer` and `path: string`, including the sentinel empty string.
- **Technical rationale:** The current type shape hides invariants instead of expressing them. This pushes correctness from the compiler into documentation and consumer guesswork.
- **Implementation direction:**
  1. Replace `PngPageOutput` with a discriminated union such as `MetadataPageOutput | RenderedPageOutput`.
  2. Model disk persistence explicitly instead of using `path: ''`.
  3. Expose mode information through a field like `kind` or `contentMode`.
- **Acceptance criteria:**
  1. Metadata-only results cannot expose `content`.
  2. Disk-backed results cannot use an empty-string sentinel path.
  3. Public examples compile without type assertions when branching on the discriminator.

### [ ] ARCH-005 Remove hidden mutation from the page processing pipeline
- **Problem:** `processAndSavePage()` and `savePNGfile()` mutate `PngPageOutput` after creation by changing `path` and deleting `content`.
- **Technical rationale:** Hidden mutation makes the lifecycle of an output object non-obvious, complicates debugging, and makes future refactors riskier. Immutable outputs are easier to reason about and test.
- **Implementation direction:**
  1. Have `renderPdfPage()` and `getPageMetadata()` return immutable intermediate values.
  2. Let the writer return a new result object with persistence metadata.
  3. Make content-retention behavior explicit in the returned type rather than mutating fields post hoc.
- **Acceptance criteria:**
  1. No helper mutates `PngPageOutput` after creation.
  2. The writer returns data instead of modifying its input argument.
  3. Tests assert result construction, not mutation side effects.

### [ ] TYPE-002 Eliminate unsafe assertions and non-null casts in `src/pdfToPng.ts` and `src/cli.ts`
- **Problem:** The code relies on `as Buffer`, `as NodeCanvasFactory`, `canvas!`, and `as { version?: string }`.
- **Technical rationale:** These assertions bypass the type system exactly where the code crosses process, filesystem, and external-library boundaries. Those are the places where runtime surprises are most likely.
- **Implementation direction:**
  1. Introduce small type guards for parsed JSON, canvas/content presence, and PDF.js adapter contracts.
  2. Add a unified internal input type such as `PdfInputBuffer` and centralize buffer normalization behind explicit type guards.
  3. Define a local interface for the canvas factory contract instead of casting `pdf.canvasFactory`.
  4. Replace `canvas!` with explicit narrowing or a factory return type that guarantees live values.
- **Acceptance criteria:**
  1. Core source files no longer use avoidable `as` casts or non-null assertions for runtime values.
  2. Buffer normalization and JSON parsing use tested type guards rather than ad hoc assertions.
  3. Type guards are covered by unit tests.
  4. ESLint/TypeScript can enforce the safer contract without suppressions.

### [ ] ARCH-006 Manage PDF.js lifecycle explicitly, including `destroy()`
- **Problem:** The render pipeline calls `pdfDocument.cleanup()` in `finally`, but it does not keep the loading task or explicitly destroy the document/transport lifecycle.
- **Technical rationale:** `cleanup()` releases render resources, but PDF.js also exposes `destroy()` on the document/loading task. Not modeling the lifecycle explicitly risks resource retention and makes the adapter contract unclear.
- **Implementation direction:**
  1. Wrap `getDocument()` in a local adapter that owns both the loading task and the `PDFDocumentProxy`.
  2. Move PDF.js module caching behind an explicit provider/service abstraction instead of a module-level side effect.
  3. Define a teardown contract that calls the appropriate `cleanup()` and `destroy()` steps deliberately.
  4. Add tests for error paths to confirm teardown runs after parse/render failures.
- **Acceptance criteria:**
  1. PDF.js loading, caching, and teardown are owned by one adapter/service.
  2. Error paths and happy paths both exercise explicit teardown.
  3. No lifecycle step is hidden inside unrelated orchestration logic.

### [ ] ARCH-007 Make the CLI a thin adapter over a reusable execution API
- **Problem:** `src/cli.ts` mixes parsing, validation, logging, error formatting, and `process.exit()` control flow in one function.
- **Technical rationale:** This makes the CLI harder to test cleanly and impossible to reuse as a library-facing execution entry point. It also spreads validation rules away from the core API.
- **Implementation direction:**
  1. Extract `parseCliArgs()` to return a typed command object.
  2. Extract `executeCliCommand()` that returns structured results or an exit code.
  3. Keep `main()` responsible only for printing and exiting.
  4. Reuse the shared option normalization layer from `ARCH-002`.
- **Acceptance criteria:**
  1. Tests no longer need to mock `process.exit()` for core CLI behavior.
  2. CLI validation is delegated to shared logic.
  3. The top-level binary wrapper is smaller than the execution logic.

### [ ] ARCH-008 Define and implement a deliberate module packaging strategy
- **Problem:** The package mixes `type: "commonjs"`, `nodenext` TypeScript, `.js` import specifiers in source, and documentation that shows both CJS and ESM usage without a clearly stated publish strategy.
- **Technical rationale:** Consumers should not need Node interop trivia to understand how to import the library. Packaging ambiguity becomes more expensive as the public API grows.
- **Implementation direction:**
  1. Choose one of: CJS only, ESM only, or dual publish.
  2. Align `package.json` `exports`, `main`, `types`, and build outputs with that choice.
  3. Add import contract tests for the supported consumption modes.
  4. Update README examples to match the actual package contract.
- **Acceptance criteria:**
  1. The package format strategy is explicit in code and docs.
  2. Import behavior is covered by tests.
  3. No example relies on unsupported or accidental interop.

### [ ] TYPE-003 Strengthen public option and metadata types
- **Problem:** Several domain fields are typed too loosely: `verbosityLevel?: number`, `pagesToProcess?: number[]`, and `rotation: number`.
- **Technical rationale:** Weak public types reduce IDE guidance, allow invalid values to flow further into the system, and force runtime checks to carry more weight than necessary.
- **Implementation direction:**
  1. Type `verbosityLevel` as `VerbosityLevel`.
  2. Introduce validated internal types for positive integers/page indices.
  3. Narrow `rotation` to `0 | 90 | 180 | 270` after validation at the PDF.js boundary.
  4. Prefer `readonly` arrays for normalized page lists passed through the pipeline.
- **Acceptance criteria:**
  1. Public types communicate domain constraints more precisely.
  2. Internal normalized types prevent invalid values from reaching renderer/writer stages.
  3. Existing examples and tests compile against the stronger contracts.

### [ ] PERF-001 Add memory-aware rendering and output-sink abstractions
- **Problem:** When `outputFolder` is set, the architecture always creates PNG buffers in memory before writing them. With parallel mode, memory usage scales with page size and `concurrencyLimit`.
- **Technical rationale:** The current model is acceptable for small documents, but it does not scale predictably for large PDFs or high-resolution renders. The concurrency knob is blind to page size and output strategy.
- **Implementation direction:**
  1. Introduce an output-sink abstraction so rendering is not tightly coupled to in-memory `Buffer` retention.
  2. Investigate direct-to-disk or chunked encoding paths supported by the canvas layer.
  3. Add an adaptive concurrency policy based on estimated canvas pixels or memory budget.
  4. Replace lock-step `Promise.all` chunking with a sliding-window scheduler or `p-limit`-style queue so new pages start as soon as earlier ones finish.
- **Acceptance criteria:**
  1. The render pipeline can target at least two sinks: in-memory and filesystem.
  2. Concurrency decisions can consider page size, not only page count.
  3. Large-document tests demonstrate bounded memory behavior under parallel mode.
  4. Parallel scheduling keeps up to `concurrencyLimit` active tasks without leaving slots idle until a whole batch completes.

### [ ] TEST-001 Expand contract tests around normalization, packaging, and security invariants
- **Problem:** The current suite is strong on integration scenarios, but it leaves gaps around normalization semantics, absolute path handling, packaging/import contracts, and stronger adversarial path cases.
- **Technical rationale:** Architectural regressions often happen at boundaries, not pixel-comparison paths. Contract tests are cheaper and more targeted than heavy integration tests.
- **Implementation direction:**
  1. Add tests for absolute `outputFolder`, empty/whitespace folder names, invalid `pagesToProcess`, and unsupported verbosity values.
  2. Add package import tests for the supported module formats.
  3. Add focused security tests for filename normalization, nested directories, and symlink behavior where practical.
- **Acceptance criteria:**
  1. The most important API guarantees are enforced by fast tests.
  2. A regression in option normalization or packaging breaks tests immediately.
  3. Security-sensitive filename/path cases are covered outside the heavy render suite.

## P3

### [ ] CLI-001 Stop reading `package.json` synchronously at runtime for `--version`
- **Problem:** `getVersion()` reads and parses `package.json` synchronously at runtime and hides all failures by returning `"Unknown"`.
- **Technical rationale:** The CLI version should be deterministic. Runtime filesystem lookup adds unnecessary failure modes and makes packaging behavior harder to reason about.
- **Implementation direction:**
  1. Inject the package version at build time or export it from generated metadata.
  2. If runtime lookup remains, cache the result and narrow the error handling to the expected failure modes.
  3. Avoid silent fallback for cases that represent packaging defects.
- **Acceptance criteria:**
  1. `--version` works without filesystem probing on every invocation.
  2. Failure behavior is deliberate and testable.
  3. Version reporting no longer depends on synchronous JSON parsing in hot CLI code.

### [ ] DX-001 Tighten release-grade type checking and dependency boundary confidence
- **Problem:** `tsconfig.json` uses `skipLibCheck: true`, which reduces friction but also hides incompatibilities at external type boundaries such as `pdfjs-dist` and `@napi-rs/canvas`.
- **Technical rationale:** This project’s core value depends on third-party adapter correctness. Suppressing upstream type issues weakens confidence exactly where the system integrates with external APIs.
- **Implementation direction:**
  1. Evaluate enabling `skipLibCheck: false` in CI or release validation, even if local development keeps the faster setting.
  2. If full strictness is too expensive, add a dedicated stricter typecheck job for release candidates.
  3. Document any upstream type gaps explicitly rather than hiding them globally.
- **Acceptance criteria:**
  1. Release validation has a stricter type boundary check than local edit-time defaults.
  2. Any remaining skipped library issues are explicit and intentional.
  3. Dependency type regressions are more likely to fail CI before release.
