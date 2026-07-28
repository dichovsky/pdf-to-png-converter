# Backlog

> **Agent Rules:** Keep descriptions brief. When a task is completed, REMOVE it from here and APPEND it to BACKLOG-ARCHIVE.md.

## 🔧 Tooling

- [ ] 🟢 🔧 TOOL-001 Toolchain: re-unify on a single `typescript@7.x` dependency
    - drop the `@typescript/typescript6` compat alias + `@typescript/native` once TS 7.1 ships a stable compiler API and typescript-eslint declares TS 7 support
    - gate on: codemap generation, ts-node scripts, lint, and full test suite passing with one dependency

## ⚙️ ARCH / Core

- [ ] 🟡 ♻️ ARCH-012 Core: colocate output-folder prepare with savePNGfile
    - move resolve + mkdir + realpath out of pdfToPngCore.ts into outputWriter.ts; return a handle
    - puts the SEC-001/002/003 threat model in one module
- [ ] 🟢 ♻️ ARCH-014 Core: close `Uint8Array | ArrayBufferLike` union at getPdfFileBuffer
    - getPdfFileBuffer always returns Uint8Array; remove the `instanceof Uint8Array ? ... : new Uint8Array(...)` in getPdfDocument
    - narrows interfaces at both seams; one place owns "what shape we hand pdfjs"
- [ ] 🟢 ♻️ ARCH-016 Core: de-duplicate flat-filename rule (with ARCH-012)
    - extract assertFlatFilename into outputWriter.ts (or shared util); pageOrchestrator + outputWriter both call it
    - one place owns the SEC-001/002/003-load-bearing predicate
