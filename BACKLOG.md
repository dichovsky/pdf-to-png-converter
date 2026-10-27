# Backlog

> **Agent Rules:** Keep descriptions brief. When a task is completed, REMOVE it from here and APPEND it to BACKLOG-ARCHIVE.md.

## 🔧 Tooling

- [ ] 🟢 🔧 TOOL-001 Toolchain: re-unify on a single `typescript@7.x` dependency
    - drop the `@typescript/typescript6` compat alias + `@typescript/native` once TS 7.1 ships a stable compiler API and typescript-eslint declares TS 7 support
    - gate on: ts-node scripts, lint, and the full test suite passing with one dependency

## ⚙️ ARCH / Core

- [ ] 🟢 🐛 ARCH-017 Core: serve pdf.js binary data through a duck-typed `BinaryDataFactory`
    - the wasm JS fallback `import()` rejects the plain-path `wasmUrl` on Windows (`C:/...`) and on POSIX install paths containing `#`, `?` or `%`; reached only when the wasm load fails (e.g. `node --jitless`)
    - pass `file://` URLs plus a factory whose `fetch({ kind, filename })` reads from disk, so the `.wasm` read and the fallback `import()` both work
- [ ] 🟢 🔧 ARCH-018 Remove the wasm warm-up once pdfjs-dist includes mozilla/pdf.js#22145
    - `warmUpWasmDecoders()` in `src/pdfjsLoader.ts` works around mozilla/pdf.js#22131 (issue #288); the upstream fix was merged on 2026-10-12 and is not in 6.4.299
    - removal also deletes the tests that pin it: `__tests__/pdfjs.loader.wasm.warmup.test.ts`, the exit-time test at the end of `__tests__/pdf.to.png.concurrent.wasm.test.ts`, and the `beforeAll` warm-up calls in `__tests__/core.scheduling.test.ts`, `__tests__/pdf.to.png.return.metadata.only.test.ts` and `__tests__/pdf.to.png.sliding.window.test.ts`; in `__tests__/loader.document.open.call.sites.test.ts` drop the `decodeWarmUpImages` expectation (the call-site guard stays, its allow-list shrinks)
    - also remove `WASM_WARM_UP_TIMEOUT_MS` in `src/const.ts`, `warmUpWasmDecoders()`, `decodeWarmUpImages()` and `buildWasmWarmUpPdf()` in `src/pdfjsLoader.ts`, the import and call in `src/pdfToPng.ts`, and the warm-up text in `CLAUDE.md` (invariant 11 and the `pdfjsLoader.ts` and `const.ts` module lines), `docs/ARCHITECTURE.md` and `.github/copilot-instructions.md`
    - gate on: `__tests__/pdf.to.png.concurrent.wasm.test.ts` passing with the warm-up removed
- [ ] 🟢 🐛 ARCH-019 Core: make `verbosityLevel` per conversion on the main thread
    - pdf.js keeps one module-level verbosity, set by every `getDocument()` call, so overlapping main-thread conversions with different levels see the level of the document opened last; it changes pdf.js log lines only, worker threads have their own, and pdfjs-dist 6.4.299 exports no setter for it
    - options: capture or filter the pdf.js console output per conversion, or serialize document opens
    - gate on: a test with two overlapping conversions at levels 1 and 0 where each sees only its own log lines
- [ ] 🟢 🐛 ARCH-020 Workers: carry pdf.js error fields across the thread boundary and leave no empty output folder
    - an error a worker reports reaches the caller as a native `Error` with the same message, name and `cause`, but pdf.js fields such as `details` and `code`, and the error class, are not carried
    - in file mode a worker-level failure after `prepareOutputFolder()` leaves an empty output folder
    - the compiled-CLI worker cases in `__tests__/pdf.to.png.worker.threads.test.ts` cannot assert routing, because a spy cannot cross the process boundary
- [ ] 🟢 🐛 ARCH-021 Core: bind a relative input path at call time and preflight filename limits beyond 255 units
    - a relative input path binds when `fs.open` runs, so a synchronous `process.chdir()` right after the call still gives ENOENT, unlike the output folder, which is bound at call time; resolving string inputs in `pdfToPng()` would put absolute paths into error messages
    - output names are preflighted against 255 units only: a filesystem with a lower per-segment limit (eCryptfs allows 143 bytes), HFS+ NFD expansion and the total path length still surface a raw `ENAMETOOLONG` from `open()`
- [ ] 🟢 🔧 ARCH-022 Core: revisit the teardown policy if `loadingTask.destroy()` can ever reject
    - `pdfToPng()` and `getPdfDocument()` await `destroy()` bare, so a rejection would replace a successful result or the original load error, while `Worker.terminate()` failures are already tolerated; no rejection occurred in 2,284 real calls on pdfjs-dist 6.4.299, and `__tests__/pdf.to.png.destroy.on.setup.failure.test.ts` pins the current policy
    - gate on: a pdfjs-dist release or a reproduction in which `destroy()` rejects

## 🖥️ CLI / DX

- [ ] 🟢 🐛 CLI-002 CLI: cap the argument list in the "expected exactly one path" usage error
    - the error lists every argument it received, so a shell glob that expands to thousands of files prints them all
    - print the first few and the total count instead

## 🛡️ SEC / QA

- [ ] 🟡 🐛 SEC-004 Sec: bound declared image size for all image filters (pdf.js `maxImageSize`)
    - every image filter (Flate, DCT, CCITT, JBIG2, JPX) costs about 8 bytes per declared pixel per rendering thread, and a Flate, DCT, CCITT, or JBIG2 image of about 537 Mpx or more is silently left out of the page while the conversion still resolves (`@napi-rs/canvas` 1.0.12 and later; up to 1.0.11 the whole conversion was rejected with `Create skia surface failed`); JPX above a size limit of pdf.js's own is decoded at a reduced resolution with a warning instead; since issue #278, CCITT/JBIG2/JPX images, which can declare such sizes from smaller files, reach this memory cost and size limit instead of rendering blank
    - decoding a large valid image is also slower with `@napi-rs/canvas` 1.0.13 than with 1.0.9: a 1-bit Flate image of 529 Mpx took about 54 s instead of about 3.5 s on one Apple Silicon Mac (absolute times vary by machine), while images up to about 36 Mpx show no slowdown
    - `maxImageSize` drops an oversized image of any filter before decoding, but it does not cover SMask images or JPX/JBIG2 files whose header size differs from the dictionary, and a 100 Mpx limit would silently blank 1200 dpi A4 scans. Choose a limit or option and make drops visible
- [ ] 🟡 🐛 SEC-006 Sec: report the pdf.js heap abort on a long run of one byte value, then decide on an in-library guard
    - in the pdf.js recovery scan a non-PDF payload that is one long run of a single byte value needs about 32 to 64 heap bytes per input byte, so a few MiB can abort the whole process with `Reached heap limit` instead of rejecting (4 MiB of zeros at a 128 MiB heap; a `%PDF-` header in front does not help); `maxInputBytes` bounds input bytes only, and the CLI has no option to lower it
    - the cause is in pdf.js, which aborts the same way without this library: file it upstream, and until it is fixed, callers set `--max-old-space-size` and convert untrusted files in an isolated process or a worker with `resourceLimits`
- [ ] 🟡 🐛 SEC-007 Sec: report the unhandled `XRefEntryException` that pdf.js leaks for some corrupt PDFs, then decide on an in-library guard
    - a PDF with a few flipped bytes in its cross-reference data makes pdf.js leave an unhandled rejection (`XRefEntryException: Bad (uncompressed) XRef entry`) shortly after the document loads, in the default, worker-thread and metadata-only modes; with no `unhandledRejection` handler Node aborts the host process (`ERR_UNHANDLED_REJECTION`, exit code 1)
    - the cause is in pdf.js: file it upstream, and until it is fixed, a host that converts untrusted files should install an `unhandledRejection` handler or convert in an isolated process
