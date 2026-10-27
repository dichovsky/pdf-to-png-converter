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
    - every image filter (Flate, DCT, CCITT, JBIG2, JPX) costs about 8 bytes per declared pixel per rendering thread, and a Flate, DCT, CCITT, or JBIG2 image of about 537 Mpx or more is silently left out of the page while the conversion still resolves (`@napi-rs/canvas` 1.0.12 and later; up to 1.0.11 the whole conversion was rejected with `Create skia surface failed`); JPX above a size limit of pdf.js's own is decoded at a reduced resolution with a warning instead; since issue #278, CCITT/JBIG2/JPX images, which can declare such sizes from smaller files, reach this memory cost and size limit instead of rendering blank
    - decoding a large valid image is also slower with `@napi-rs/canvas` 1.0.13 than with 1.0.9: a 1-bit Flate image of 529 Mpx took about 54 s instead of about 3.5 s on one Apple Silicon Mac (absolute times vary by machine), while images up to about 36 Mpx show no slowdown
    - `maxImageSize` drops an oversized image of any filter before decoding, but it does not cover SMask images or JPX/JBIG2 files whose header size differs from the dictionary, and a 100 Mpx limit would silently blank 1200 dpi A4 scans. Choose a limit or option and make drops visible
