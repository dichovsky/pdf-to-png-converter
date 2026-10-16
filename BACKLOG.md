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
    - gate on: `__tests__/pdf.to.png.concurrent.wasm.test.ts` passing with the warm-up removed

## 🛡️ SEC / QA

- [ ] 🟡 🐛 SEC-004 Sec: bound declared image size for all image filters (pdf.js `maxImageSize`)
    - every image filter (Flate, DCT, CCITT, JBIG2, JPX) costs about 8 bytes per declared pixel per rendering thread, and an image of about 537 Mpx or more rejects the whole conversion with `Create skia surface failed`; since issue #278, CCITT/JBIG2/JPX images reach that path instead of rendering blank
    - `maxImageSize` drops an oversized image of any filter before decoding, but it does not cover SMask images or JPX/JBIG2 files whose header size differs from the dictionary, and a 100 Mpx limit would silently blank 1200 dpi A4 scans. Choose a limit or option and make drops visible
