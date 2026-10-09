# Backlog

> **Agent Rules:** Keep descriptions brief. When a task is completed, REMOVE it from here and APPEND it to BACKLOG-ARCHIVE.md.

## 🔧 Tooling

- [ ] 🟢 🔧 TOOL-001 Toolchain: re-unify on a single `typescript@7.x` dependency
    - drop the `@typescript/typescript6` compat alias + `@typescript/native` once TS 7.1 ships a stable compiler API and typescript-eslint declares TS 7 support
    - gate on: ts-node scripts, lint, and the full test suite passing with one dependency

## ⚙️ ARCH / Core

_No open ARCH items._

## 🛡️ SEC / QA

- [ ] 🟡 🐛 SEC-004 Sec: bound declared image size (pdf.js `maxImageSize`)
    - the wasm decoders now run (issue #278): about 8 bytes per declared pixel per rendering thread, and an image of about 537 Mpx or more rejects the whole conversion with `Create skia surface failed`
    - `maxImageSize` drops an oversized image before decoding, but it does not cover SMask images or JPX/JBIG2 files whose header size differs from the dictionary, and a 100 Mpx limit would silently blank 1200 dpi A4 scans. Choose a limit or option and make drops visible
