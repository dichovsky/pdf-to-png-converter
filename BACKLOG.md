# Backlog

> **Agent Rules:** Keep descriptions brief. When a task is complete, remove it from this file and append it to `BACKLOG-ARCHIVE.md`.

## 🔧 Tooling

- [ ] 🟢 🔧 TOOL-001 Toolchain: unify on a single `typescript@7.x` dependency
    - Remove the `@typescript/typescript6` alias and `@typescript/native` after TypeScript 7.1 ships a stable compiler API and `typescript-eslint` supports TypeScript 7.
    - Gate on: `ts-node` scripts, ESLint, and the full test suite passing with one `typescript` dependency.

## ⚙️ ARCH / Core

- [ ] 🟢 🐛 ARCH-017 Core: serve pdf.js binary data through a `BinaryDataFactory`
    - The WebAssembly JavaScript fallback `import()` rejects plain-path `wasmUrl` values on Windows (`C:/...`) and on POSIX paths containing `#`, `?`, or `%` (triggered when WebAssembly loading fails, such as `node --jitless`).
    - Pass `file://` URLs with a factory whose `fetch({ kind, filename })` reads from disk so both `.wasm` reads and fallback `import()` calls succeed.
- [ ] 🟢 🔧 ARCH-018 Remove the WebAssembly warm-up now that `pdfjs-dist` includes mozilla/pdf.js#22145
    - `warmUpWasmDecoders()` in `src/pdfjsLoader.ts` works around mozilla/pdf.js#22131 (issue #288).
    - Delete the warm-up tests: `__tests__/pdfjs.loader.wasm.warmup.test.ts`, the exit-time test in `__tests__/pdf.to.png.concurrent.wasm.test.ts`, and the `beforeAll` warm-up calls in `__tests__/core.scheduling.test.ts`, `__tests__/pdf.to.png.return.metadata.only.test.ts`, and `__tests__/pdf.to.png.sliding.window.test.ts`. Remove `decodeWarmUpImages` from the allow-list in `__tests__/loader.document.open.call.sites.test.ts`.
    - Remove `WASM_WARM_UP_TIMEOUT_MS` in `src/const.ts`, `warmUpWasmDecoders()`, `decodeWarmUpImages()`, and `buildWasmWarmUpPdf()` in `src/pdfjsLoader.ts`, the warm-up call in `src/pdfToPng.ts`, and the warm-up documentation in `CLAUDE.md`, `docs/ARCHITECTURE.md`, and `.github/copilot-instructions.md`.
    - Gate on: `__tests__/pdf.to.png.concurrent.wasm.test.ts` passing without warm-up.
- [ ] 🟢 🐛 ARCH-019 Core: isolate `verbosityLevel` per conversion on the main thread
    - pdf.js stores one module-level verbosity setting on the main thread and updates it on each `getDocument()` call, so concurrent main-thread conversions share the last applied level.
    - Options: filter pdf.js console output per conversion or serialize `getDocument()` calls.
    - Gate on: a test with two concurrent conversions at levels `1` and `0` where each receives only its own log lines.
- [ ] 🟢 🐛 ARCH-020 Workers: preserve pdf.js error properties across worker threads and avoid empty output folders
    - Worker errors return as native `Error` instances with `message`, `name`, and `cause`, but omit pdf.js properties such as `details` and `code`.
    - In file mode, a worker-level failure after `prepareOutputFolder()` leaves an empty output folder on disk.
    - Compiled CLI worker tests in `__tests__/pdf.to.png.worker.threads.test.ts` cannot use in-process spies across child processes.
- [ ] 🟢 🐛 ARCH-021 Core: resolve relative input paths at call time and check filesystem-specific filename limits
    - Relative input paths resolve when `fs.open` runs rather than synchronously when `pdfToPng()` is called.
    - Output filenames are checked against 255 units only; filesystems with lower segment limits (such as 143 bytes on eCryptfs), HFS+ NFD expansion, and total path length limits still fail at `open()` with `ENAMETOOLONG`.
- [ ] 🟢 🔧 ARCH-022 Core: review teardown policy if `loadingTask.destroy()` can reject
    - `pdfToPng()` and `getPdfDocument()` await `destroy()` directly, so a rejection from `destroy()` would mask the conversion result or load error (`__tests__/pdf.to.png.destroy.on.setup.failure.test.ts` pins this behavior).
    - Gate on: a `pdfjs-dist` version or reproduction where `destroy()` rejects.

## 🖥️ CLI / DX

- [ ] 🟢 🐛 CLI-002 CLI: truncate the argument list in the multiple-path usage error
    - The error prints every extra argument, which produces excessive output when a shell glob expands to many files.
    - Print only the first few arguments and the total count.

## 🛡️ SEC / QA

- [ ] 🟡 🐛 SEC-004 Sec: limit declared image size across all image filters (pdf.js `maxImageSize`)
    - Every image filter uses about 8 bytes per declared pixel per rendering thread, and Flate, DCT, CCITT, or JBIG2 images of 537 Mpx or more are silently omitted by `@napi-rs/canvas` 1.0.12+.
    - Large valid images (above 36 Mpx) also decode more slowly in `@napi-rs/canvas` 1.0.13+.
    - Evaluate a default or configurable `maxImageSize` limit and report dropped images clearly.
- [ ] 🟡 🐛 SEC-006 Sec: report the pdf.js heap abort on long runs of identical bytes and evaluate an input guard
    - During xref recovery, a long run of one byte value (such as zeros) uses 32 to 64 heap bytes per input byte in pdf.js and can abort the process with `Reached heap limit`.
    - Report the issue upstream to pdf.js and evaluate a pre-scan guard.
- [ ] 🟡 🐛 SEC-007 Sec: report the unhandled `XRefEntryException` in pdf.js on corrupt xref tables
    - Certain corrupted xref entries cause pdf.js to emit an unhandled `XRefEntryException` rejection after document load.
    - Report the issue upstream to pdf.js and evaluate an in-library guard.
