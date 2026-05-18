# Backlog Archive

> **Agent Rules:** Append completed tasks here. Add Impl: (Implementation details) and Rat: (Rationale/Why).

## ⚙️ ARCH / Core

- [x] 🟡 🐛 ARCH-001 Core: fix abs outputFolder resolution
  - **Impl:** swap `join(cwd, p)` → `resolve(p)` in pdfToPng.ts L142; update savePNGfile JSDoc
  - **Rat:** join silently rewrites abs paths under cwd, breaking documented relative/abs contract
- [x] 🟡 ♻️ ARCH-002 Core: single option normalization + validation layer
  - **Impl:** new `src/normalizePdfToPngOptions.ts`; reject empty outputFolder, bad verbosityLevel, ≤0 pages
  - **Rat:** consolidate split validation across cli.ts + pdfToPng.ts; create stable test seam
- [x] 🟡 ♻️ ARCH-003 Core: split pdfToPng.ts into composable modules
  - **Impl:** extract pdfInput, pdfjsLoader, pageRenderer, outputWriter, pageOrchestrator; pdfToPng.ts <80 LOC
  - **Rat:** ~490 LOC blob owned 8 responsibilities, blocked isolated unit testing
- [x] 🟡 🐛 ARCH-004 Core: harden writes vs symlink/TOCTOU
  - **Impl:** replace `fsPromises.writeFile` with `open(path, 'wx')` + fd.writeFile in savePNGfile
  - **Rat:** writeFile follows symlinks at target, defeating containment; `wx` fails EEXIST on POSIX
- [x] 🟡 ♻️ ARCH-005 Core: remove hidden mutation from page pipeline
  - **Impl:** savePNGfile returns `Promise<string>`; processAndSavePage builds new object via spread
  - **Rat:** mutating `pageOutput.path` and `.content` hid lifecycle, complicated debugging
- [x] 🟡 🐛 ARCH-006 Core: explicit pdfjs lifecycle with destroy()
  - **Impl:** swap cleanup() → destroy() in finally; wrap loading task .promise to destroy on reject
  - **Rat:** cleanup() only clears render cache; destroy() also terminates worker transport, frees memory
- [x] 🟡 ♻️ ARCH-007 Core: CLI as thin adapter over reusable execution API
  - **Impl:** extract buildPdfToPngOptions + executeConversion; run() <35 LOC, no process.exit mocks
  - **Rat:** 134-LOC run() mixed parsing, validation, logging, exit — untestable in isolation
- [x] 🟡 🧪 ARCH-008 Core: confirm + document CJS-only packaging
  - **Impl:** new `__tests__/exports.contract.test.ts`; add `_packageFormatNote` to package.json
  - **Rat:** mixed CJS + nodenext + .js specifiers is correct but lacked contract test against regression

## 🧱 TYPE / Public API

- [x] 🟡 ♻️ TYPE-001 API: discriminated PngPageOutput union (major bump)
  - **Impl:** split into Metadata/InMemory/File variants with `kind` tag; update CHANGELOG + README
  - **Rat:** single shape hid 3 modes behind `content?` + sentinel `path: ''`; invariants in docs not types
- [x] 🟡 ♻️ TYPE-002 API: eliminate unsafe assertions + non-null casts
  - **Impl:** drop redundant `as Buffer`; add isNodeCanvasFactory guard; throw on null canvas / non-Buffer
  - **Rat:** four casts bypassed types at process/fs/library boundaries — exactly where surprises happen
- [x] 🟡 ♻️ TYPE-003 API: strengthen verbosityLevel + rotation types
  - **Impl:** verbosityLevel uses VerbosityLevel enum; rotation literal `0|90|180|270`; normalizeRotation helper
  - **Rat:** `number` widened public types; IDE gave no guidance, invalid values flowed to pdfjs

## ⚡ PERF

- [x] 🟡 ♻️ PERF-001a Perf: OutputSink abstraction
  - **Impl:** new OutputSink interface; FilesystemSink + NullSink; processAndSavePage uses injected sink
  - **Rat:** rendering was tightly coupled to in-memory Buffer; prerequisite for any sink/scheduling improvement
- [x] 🟡 ♻️ PERF-001b Perf: sliding-window page scheduler
  - **Impl:** replace Promise.all chunking with index-counter sliding window; preserve doc order
  - **Rat:** lock-step batches left concurrency slots idle when one page finished early; throughput loss

## 🖥️ CLI / DX

- [x] 🟡 🐛 CLI-001 CLI: stop swallowing getVersion() failures
  - **Impl:** throw on missing/malformed package.json; run() try/catch → console.error + exit(1)
  - **Rat:** returning 'Unknown' masked packaging defects; missing version is a bug, not a runtime state
- [x] 🟡 📦 DX-001 DX: stricter type-check job for release
  - **Impl:** new tsconfig.strict.json (skipLibCheck:false); npm run build:strict; CI step continue-on-error
  - **Rat:** main tsconfig hides type gaps in pdfjs-dist + @napi-rs/canvas — the most critical integrations

## 🛡️ SEC / QA

- [x] 🟡 🧪 TEST-001 QA: expand contract + security tests
  - **Impl:** 10-row table in `__tests__/security.path.test.ts` covers escapes, abs names, empty mask, bad pages
  - **Rat:** suite was strong on render integration but lacked boundary contract tests where regressions happen
- [x] 🟡 🐛 SEC-001 Sec: reject path separators in resolved page names
  - **Impl:** guard `[\\/]` in resolvePageName + savePNGfile (defense in depth); update JSDoc
  - **Rat:** intermediate-dir symlink swap could win TOCTOU race vs realpath/open; flat-name rule closes class
- [x] 🟡 🐛 SEC-002 Sec: cap input PDF size to prevent OOM
  - **Impl:** MAX_INPUT_BYTES=256MiB; stat() + isFile() pre-check on path branch; byteLength check on buffer branch
  - **Rat:** unbounded readFile of `/dev/zero` or fifo OOM-kills Node; clean DoS in service contexts
- [x] 🟡 🐛 SEC-003 Sec: cap concurrencyLimit upper bound
  - **Impl:** MAX_CONCURRENCY_LIMIT=16 enforced in normalizePdfToPngOptions when processPagesInParallel
  - **Rat:** N workers × 400MB canvas cap = attacker-driven memory blowup; default 4 unaffected
