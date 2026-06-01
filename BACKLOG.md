# Backlog

> **Agent Rules:** Keep descriptions brief. When a task is completed, REMOVE it from here and APPEND it to BACKLOG-ARCHIVE.md.

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
