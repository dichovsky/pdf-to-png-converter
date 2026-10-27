# pdf-to-png-converter

<p align="center">
  <strong>🎯 Convert PDF pages to PNG images with no native compilation required</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pdf-to-png-converter">
    <img src="https://img.shields.io/npm/v/pdf-to-png-converter.svg?style=flat-square" alt="npm version">
  </a>
  <a href="https://www.npmjs.com/package/pdf-to-png-converter">
    <img src="https://img.shields.io/npm/dm/pdf-to-png-converter.svg?style=flat-square" alt="npm downloads">
  </a>
  <a href="https://github.com/dichovsky/pdf-to-png-converter/actions/workflows/test.yml">
    <img src="https://github.com/dichovsky/pdf-to-png-converter/actions/workflows/test.yml/badge.svg?branch=main" alt="Tests">
  </a>
  <a href="https://github.com/dichovsky/pdf-to-png-converter/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/dichovsky/pdf-to-png-converter?style=flat-square" alt="License">
  </a>
</p>

---

A high-performance Node.js library for converting PDF files and buffers to PNG images. Perfect for web applications, document processing pipelines, and image generation workflows.

**Key Benefits:**

- ✨ **No Build-Time Compilation** - Pre-built native binaries included via `@napi-rs/canvas`, no `node-gyp` or compiler toolchain required
- 🚀 **High Performance** - Supports parallel page processing
- 🔐 **Encrypted PDFs** - Handle password-protected documents
- 📦 **Lightweight** - Minimal dependencies
- 💪 **TypeScript Support** - Full type definitions included
- 🎨 **Flexible Rendering** - Advanced font and rendering options

> **Note:** `@napi-rs/canvas` ships platform-specific pre-built native binaries (no compilation step). See the [@napi-rs/canvas repository](https://github.com/Brooooooklyn/canvas) for the full list of supported platforms.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Usage](#cli-usage)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Performance Notes](#performance-notes)
- [Troubleshooting](#troubleshooting)
- [Output Format](#output-format)
- [Migration Guide](#migration-guide)
- [Project Links](#project-links)
- [License](#license)

---

## Installation

### npm

```sh
npm install pdf-to-png-converter
```

### Yarn

```sh
yarn add pdf-to-png-converter
```

> **Node.js Requirement:** Node.js 22.13 or higher is required.

---

## Quick Start

Convert a PDF file to PNG images in just a few lines:

```javascript
const { pdfToPng } = require('pdf-to-png-converter');

(async () => {
    const pngPages = await pdfToPng('document.pdf', {
        outputFolder: './output',
    });

    console.log(`Converted ${pngPages.length} pages`);
})();
```

Or with TypeScript:

```typescript
import { pdfToPng, VerbosityLevel, type PngPageOutput } from 'pdf-to-png-converter';

const pngPages: PngPageOutput[] = await pdfToPng('document.pdf', {
    outputFolder: './output',
    verbosityLevel: VerbosityLevel.ERRORS, // 0=ERRORS, 1=WARNINGS, 5=INFOS
});
```

> **Existing files are not overwritten.** Disk writes use exclusive-create mode, so a pre-existing target causes `EEXIST`. If a write fails after its file was created (for example a full disk), that file is removed (best effort, and only while the path still names the file this call created) and the original error is thrown, so no truncated PNG stays under its final name (a file whose identity could not be read from its handle is left in place); files of pages written before the failure stay. Use an output directory that untrusted users cannot modify: the folder checks are pathname-based, so they cannot bind a write, or that removal, to a directory inode. Names within one disk-output request must also be unique after folding letter case and Unicode forms: `Page.png` and `page.png`, `straße.png` and `STRASSE.png`, or the precomposed and decomposed spellings of `é` count as one name on every platform. Colliding names, and names longer than 255 units (UTF-16 code units on macOS and Windows, UTF-8 bytes elsewhere), are rejected before the output folder is created.

---

## CLI Usage

You can use the converter directly from the terminal without writing code:

```sh
npx pdf-to-png-converter my-document.pdf --output-folder ./output
```

**Options:**

- `--output-folder <dir>`: Directory to save PNG files. Required for image conversion. Existing targets are not overwritten; a pre-existing target causes `EEXIST`.
- `--viewport-scale <number>`: Scale factor applied to each page viewport (default: `1`, maximum: `100`).
- `--use-system-fonts`: Attempt to use fonts installed on the host system.
- `--disable-font-face <true|false|1|0>`: Draw glyphs as paths (default: `true`; embedded fonts are still used). `false` is coerced to `true` with the process warning `PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED`, because pdf.js has no Font Loading API in Node.js.
- `--enable-xfa <true|false|1|0>`: Process XFA form data.
- `--pdf-file-password <pwd>`: Password for encrypted PDFs. Without this flag the CLI reads the `PDF_TO_PNG_PASSWORD` environment variable (the flag wins when both are set, and an empty variable counts as unset). Prefer the variable, set from a secret store or CI secret rather than typed inline: the flag is visible in process listings, and shell history and audit logs keep any password typed on a command line (see [SECURITY.md](SECURITY.md)). Quote a password that contains spaces: the usage error for a second path lists every stray argument.
- `--pages-to-process <n,m,...>`: Comma-separated list of 1-based page numbers.
- `--verbosity-level <number>`: pdfjs verbosity level (0=errors, 1=warnings, 5=infos). The CLI writes pdf.js messages from the main thread to stderr; worker threads (`--render-in-worker-threads`) keep their own console, so their Info lines can still reach stdout.
- `--return-metadata-only`: Return page metadata without rendering images. This prints JSON to stdout and does not require `--output-folder`.
- `--process-pages-in-parallel`: Process pages concurrently.
- `--concurrency-limit <number>`: Maximum number of in-flight pages, or worker-pool size with worker-thread rendering (default: `4`, range when enabled: `1..16`).
- `--render-in-worker-threads`: Rasterize pages across worker threads for true multi-core rendering.
- `--silent`: Suppress progress and success messages. Metadata JSON and errors are still printed.
- `--version`: Show package version.
- `--help`: Show help text.

The CLI has two output modes:

- image conversion: writes PNG files to `--output-folder`
- metadata inspection: prints JSON metadata to stdout with `--return-metadata-only`, including when `--silent` is set; stdout carries only that JSON, even at `--verbosity-level 5`

If you need in-memory PNG buffers, use the library API (`returnPageContent`) rather than the CLI.

The CLI takes exactly one `<pdf-file-path>`; loop in the shell to convert several files. A second positional argument is a usage error (exit code 1). That includes a value after a flag that takes none, such as `--use-system-fonts false`, and the second word of an unquoted path that contains a space. The CLI cannot raise the 256 MiB input size limit; only the library option `maxInputBytes` can.

---

## API Reference

### `pdfToPng(input, options?)`

Converts PDF pages to PNG images.

**Parameters:**

| Parameter | Type                                      | Description                                      |
| --------- | ----------------------------------------- | ------------------------------------------------ |
| `input`   | `string \| ArrayBufferLike \| Uint8Array` | PDF file path, ArrayBuffer, or Uint8Array/Buffer |
| `options` | `PdfToPngOptions`                         | Optional configuration object                    |

A string `input` is always read as a file path of at most 4096 characters. A longer string is rejected before any file access, without being echoed in the error; pass PDF bytes as a `Buffer` or `Uint8Array` instead.

**Returns:** `Promise<PngPageOutput[]>` - Array of converted PNG pages

### Options

```typescript
{
    // Font & Rendering Options
    disableFontFace?: boolean,       // Draw glyphs as paths (default: true); embedded fonts are still used
                                     // false is ignored: pdf.js has no Font Loading API in Node.js, so true
                                     // is used and a one-time process warning
                                     // (PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED) reports it
    useSystemFonts?: boolean,        // Use system fonts as fallback (default: false)
    enableXfa?: boolean,             // Render XFA forms (default: true)

    // Output Options
    outputFolder?: string,           // Directory to save PNG files; existing files are not overwritten
                                     // A relative path is resolved against process.cwd() when pdfToPng()
                                     // is called, so a later process.chdir() cannot redirect the output
                                     // null counts as unset, here and for outputFileMaskFunc
    outputFileMaskFunc?: (pageNumber: number) => string, // Custom filename function
                                     // Must return a non-empty flat name. "/" is always rejected;
                                     // "\" is also rejected on Windows. For disk output, NUL and
                                     // directory aliases are rejected; Windows also rejects invalid
                                     // characters, device names, streams, and trailing dots/spaces.
                                     // For disk output, a name over 255 units (UTF-16 code units on
                                     // macOS and Windows, UTF-8 bytes elsewhere) is also rejected,
                                     // before the output folder is created.

    // Rendering Options
    viewportScale?: number,          // PNG scale/zoom level (default: 1.0, max: 100)
                                     // Note: large pages can still hit the 100-million-pixel canvas limit
                                     // at scales well below 100, and a canvas side over 1,000,000 px (a
                                     // very long, thin page) is rejected too. Reduce viewportScale if you
                                     // get an error.

    // Security
    pdfFilePassword?: string,        // Password for encrypted PDFs
    maxInputBytes?: number,          // Max input PDF size in bytes (default: 256 * 1024 * 1024)
                                     // Path inputs are opened once, then fstat()'d and bounded-read
                                     // through that same handle; non-regular files are rejected.
                                     // In-memory byte containers, including cross-realm views and
                                     // byte Arrays (for example the data array of a JSON-serialized
                                     // Buffer), are copied and checked against the cap. Any other object
                                     // with a numeric length is rejected as "Unsupported buffer type".
                                     // The cap limits input bytes only, not the memory pdf.js needs to
                                     // parse them (see Performance Notes).

    // Processing
    pagesToProcess?: number[],       // 1-indexed integer pages to convert (e.g., [1, 3, 5])
                                    // Non-integer and <= 0 values throw; pages beyond the PDF length are ignored
                                    // Must be a real array without holes; typed arrays, Sets, and sparse arrays throw
    processPagesInParallel?: boolean, // Enable parallel processing (default: false)
    concurrencyLimit?: number,       // Max concurrent pages (parallel) / worker-pool size (worker
                                     // threads): integer 1..16 (default: 4). The upper bound caps
                                     // peak in-flight page-canvas memory at ~6.4 GB
                                     // (large declared images: see Performance Notes).
    renderInWorkerThreads?: boolean, // Rasterize pages in a pool of worker threads (default: false)
                                     // True multi-core parallelism (pool size = concurrencyLimit); each
                                     // worker loads its own document copy. Pays off on multi-page,
                                     // render-heavy PDFs; identical pixels, ordered results.
                                     // Needs the installed, unbundled package (see Troubleshooting).
                                     // A pdf.js error thrown in a worker reaches you as a plain Error
                                     // with the same message, name, and cause; its class and fields
                                     // such as details and code are not carried across.

    // Output Control
    returnPageContent?: boolean,     // Include PNG buffer in output (default: true)
    returnMetadataOnly?: boolean,    // Return only page dimensions/rotation without rendering (default: false)

    // Logging
    verbosityLevel?: VerbosityLevel, // VerbosityLevel.ERRORS | WARNINGS | INFOS (default: ERRORS)
                                      // Use the VerbosityLevel enum for readable values:
                                      // import { VerbosityLevel } from 'pdf-to-png-converter'
                                      // pdf.js keeps one level per thread, and each conversion sets it when
                                      // it opens its document, so with overlapping main-thread conversions
                                      // the document opened last decides the level for all of them. It
                                      // changes log lines only, never output or errors. Worker threads
                                      // have their own level.
}
```

---

## Examples

### Basic Usage

```javascript
const { pdfToPng } = require('pdf-to-png-converter');

(async () => {
    const pngPages = await pdfToPng('document.pdf', {
        outputFolder: './output',
    });
    console.log(`Successfully converted ${pngPages.length} pages`);
})();
```

### Advanced Configuration

```typescript
import { pdfToPng, VerbosityLevel } from 'pdf-to-png-converter';

const pngPages = await pdfToPng('document.pdf', {
    // Rendering
    viewportScale: 2.0, // 2x zoom for higher resolution
    useSystemFonts: true, // Fallback to system fonts

    // Output
    outputFolder: './pdf-images',
    outputFileMaskFunc: (pageNumber) => `page-${String(pageNumber).padStart(3, '0')}.png`,
    returnPageContent: true,

    // Performance
    processPagesInParallel: true,
    concurrencyLimit: 8,

    // Logging
    verbosityLevel: VerbosityLevel.WARNINGS, // Log warnings
});
```

### Convert Specific Pages

```javascript
const pngPages = await pdfToPng('document.pdf', {
    outputFolder: './output',
    pagesToProcess: [1, 3, 5], // Only convert first, third, and fifth pages
});
```

### Handle Encrypted PDFs

```javascript
const pngPages = await pdfToPng('protected.pdf', {
    outputFolder: './output',
    pdfFilePassword: 'mypassword',
});
```

### Convert from Buffer

```javascript
const fs = require('fs');
const { pdfToPng } = require('pdf-to-png-converter');

(async () => {
    const pdfBuffer = fs.readFileSync('document.pdf');
    const pngPages = await pdfToPng(pdfBuffer, {
        outputFolder: './output',
        outputFileMaskFunc: (pageNumber) => `page_${pageNumber}.png`,
    });
})();
```

### Memory-Efficient Processing

```javascript
// Without returning page content (saves memory for large PDFs)
const pngPages = await pdfToPng('large-document.pdf', {
    outputFolder: './output',
    returnPageContent: false, // Don't keep PNG buffers in memory
    processPagesInParallel: true, // Process multiple pages concurrently
    concurrencyLimit: 4,
});

// Pages are written to disk, content property will be undefined
pngPages.forEach((page) => {
    if (page.kind === 'file') {
        console.log(`Saved: ${page.path}`);
    }
});
```

### Get Page Metadata Only

```javascript
// Inspect page dimensions and rotation without rendering any images
const pages = await pdfToPng('document.pdf', {
    returnMetadataOnly: true,
});

pages.forEach((page) => {
    console.log(`Page ${page.pageNumber}: ${page.width}x${page.height}px, rotation=${page.rotation}`);
});
```

This is significantly faster than full rendering and useful for checking page counts, dimensions, or orientation before deciding how to process a document.

---

## Performance Notes

- **Pipelined processing.** PNG encoding runs on the libuv threadpool and overlaps page rendering, so files may finish writing out of page order even in default (non-parallel) mode. Always consume results via the resolved, page-ordered array rather than directory-watch order.
- **Threadpool sizing.** PNG encodes and disk writes share Node's libuv threadpool (4 threads by default). For parallel file-output workloads on many-core machines, raising it can help: `UV_THREADPOOL_SIZE=8 node app.js`.
- **Strict serial processing.** If you need exactly one page in flight at a time (minimal memory, strict on-disk ordering), use `processPagesInParallel: true` with `concurrencyLimit: 1` — a sliding window of exactly one page.
- **Multi-core rendering.** `processPagesInParallel` interleaves pages on one thread — rasterization itself never runs in parallel. For CPU-bound documents (large embedded images, complex vector art), `renderInWorkerThreads: true` rasterizes pages in a pool of worker threads instead (measured about 2.4× end-to-end on a 12-page image-heavy document with the default pool of 4). Cost: one PDF copy + one pdf.js instance of memory per worker, plus one extra copy of the PDF retained on the main thread for the duration of the conversion, and a few hundred ms of pool startup per conversion — so prefer it for multi-page, render-heavy work rather than small documents.
- **Large images and untrusted PDFs.** An image costs memory and time according to the size it declares, not the size of the PDF file, so a small file can still demand a lot.
    - **Memory.** pdf.js decodes every image, whatever its compression (Flate, JPEG, CCITT, JBIG2, or JPEG 2000), into a temporary canvas that costs about 8 bytes per declared image pixel on each thread that renders a page (the main thread, or each worker with `renderInWorkerThreads`). JPEG 2000 above a size limit of pdf.js's own is decoded at a reduced resolution first, so it costs less.
    - **Time.** Decoding time grows much faster than the pixel count. Measured on an Apple Silicon Mac with a 1-bit Flate image: 36 million pixels (a 600 dpi A4 scan has 35 million) took 0.5 s, 144 million 1.4 s, 256 million 3 s, 400 million 9 s, and 529 million 54 s; a CCITT G4 image of 529 million pixels took 53 s. Times on other hardware will differ.
    - **Too large for a canvas.** An image declared at about 537 million pixels or more (for example an A0 bilevel scan at 600 dpi, 19866×28087) needs a canvas of 2 GiB or more (4 bytes per pixel). For a Flate, JPEG, CCITT, or JBIG2 image, `@napi-rs/canvas` creates that canvas but silently ignores everything drawn into it, so `pdfToPng()` resolves, the image is missing from the page, and no error or warning is reported, even with `VerbosityLevel.WARNINGS`. JPEG 2000 is the exception: pdf.js decodes a JPEG 2000 image that exceeds a lower size limit of its own at a reduced resolution, so the image is drawn with less detail, and a warning is logged with `VerbosityLevel.WARNINGS` (a file that cannot be reduced is left out, with an `Unable to decode image` warning).
    - **Wasm decoders.** CCITT, JBIG2, and JPEG 2000 images can declare such sizes from even smaller files, and they also use the wasm decoders shipped in `pdfjs-dist`: each decoder instance is capped at 2 GiB of wasm heap, and every worker has its own.
    - **Limits.** Neither `maxInputBytes` nor the canvas pixel limit bounds the size of an image declared inside the PDF. For untrusted PDFs, set container memory limits and per-job time limits.
    - **Corrupt and non-PDF input.** `maxInputBytes` limits the input bytes, not the memory pdf.js needs to parse them. When pdf.js has to rebuild a missing or damaged cross-reference table, a long run of the same byte (a file of zeros, for example; a run of spaces or line breaks is cheap) costs about 32 to 64 bytes of heap per input byte, so a junk file well under `maxInputBytes` can exhaust the heap and abort the process with `JavaScript heap out of memory`, not a rejection you can catch. For untrusted PDFs, set `--max-old-space-size` and convert in an isolated process, or in a worker thread of your own created with `resourceLimits`. `renderInWorkerThreads` does not help, because the main thread opens the document first.
    - **Concurrency.** On the main thread (the default mode and `processPagesInParallel`) pdf.js decodes images one at a time, so the peak stays near one image whatever the concurrency (measured: three 20000×20000 images peak at 3.3 GB, the same as one). With `renderInWorkerThreads` every worker decodes at the same time with its own memory, so the peak multiplies (measured at 20000×20000: 2 workers 6.3 GB, 4 workers 12.5 GB); lower `concurrencyLimit` to limit that.

---

## Troubleshooting

- **A scanned page renders blank.** pdf.js reports image decode failures only as warnings and still renders the rest of the page. Run with `verbosityLevel: VerbosityLevel.WARNINGS` (CLI: `--verbosity-level 1`) and look for `Unable to decode image` in the output. If there is no such warning, check whether the image is declared at about 537 million pixels or more: a Flate, JPEG, CCITT, or JBIG2 image that large is silently left out and nothing is logged (see [Performance Notes](#performance-notes)). Run the conversion on its own: pdf.js keeps one verbosity level per thread, so a conversion running at the same time with a different `verbosityLevel` can hide these warnings.
- **`PDF_TO_PNG_WASM_MISSING` process warning.** CCITT, JBIG2, and JPEG 2000 images are decoded by `jbig2.wasm` and `openjpeg.wasm` in the `wasm` folder of the installed `pdfjs-dist` package. If either file is missing, the library emits this Node.js process warning at most once per thread (the library runs the check on the main thread only, so normally once per process), and images that use those compressions may render blank, or decode more slowly through the pdf.js JavaScript fallback where it is available. The warning only detects missing files, not decode errors. Reinstall your dependencies to restore the files. To silence only this warning, run Node with `--disable-warning=PDF_TO_PNG_WASM_MISSING` or add that flag to `NODE_OPTIONS`; `--no-warnings` would hide every process warning.
- **`PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED` process warning.** You passed `disableFontFace: false` (or `--disable-font-face false`). pdf.js has no Font Loading API in Node.js, so `false` would draw text in embedded fonts as missing-glyph boxes. The library ignores the value, uses `true`, and emits this Node.js process warning at most once per thread (normally once per process). Remove the option. To silence only this warning, run Node with `--disable-warning=PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED` or add that flag to `NODE_OPTIONS`; `--no-warnings` would hide every process warning.
- **`Cannot resolve "pdfjs-dist/package.json"`.** The pdf.js `cmaps`, `standard_fonts`, and `wasm` folders are read from the installed `pdfjs-dist` package, not from the working directory, so that package must be resolvable from `pdf-to-png-converter`. Check for a bundler that inlines `pdfjs-dist`, or an incomplete install.
- **`renderInWorkerThreads` cannot locate `pageRenderWorker.js` because `__dirname` is not defined.** Worker mode loads the compiled `pageRenderWorker.js` from beside the library, so it needs the unbundled `out/` directory of the installed package and cannot run from code where `pdf-to-png-converter` is inlined into an ESM bundle. Import the package from `node_modules` instead of bundling it, or turn `renderInWorkerThreads` off; the other modes are not affected.

---

## Output Format

The `pdfToPng` function returns an array of discriminated page objects. Branch on `kind` before using mode-specific fields:

| `kind`     | When returned                    | `path`    | `content`                                       |
| ---------- | -------------------------------- | --------- | ----------------------------------------------- |
| `metadata` | `returnMetadataOnly: true`       | `''`      | `undefined`                                     |
| `content`  | Rendering without `outputFolder` | `''`      | PNG `Buffer`, unless `returnPageContent: false` |
| `file`     | Rendering with `outputFolder`    | File path | PNG `Buffer`, unless `returnPageContent: false` |

All output objects also include `pageNumber`, `name`, `width`, `height`, and `rotation`. `width` and `height` are integer pixel dimensions of the rendered image: a fractional viewport (for example a 595×842 pt A4 page at `viewportScale: 1.5`, i.e. 892.5×1263) is floored to match the bitmap the canvas allocates (892×1263). A viewport length up to 1e-6 px below a whole number counts as that number, so floating-point noise does not cost a pixel: a 612×792 pt Letter page at `viewportScale: 350 / 72` is 2975×3850 px, not 2974×3849. `returnMetadataOnly` reports the same floored dimensions a render would produce — and, for the same reason, rejects the same unrenderable pages a render would: a `viewportScale` that floors a page to `0` px, one whose rendered (floored) canvas area exceeds the internal canvas pixel limit, or one that makes a floored width or height exceed the 1,000,000 px per-side limit of the PNG encoder, throws the identical error on both paths rather than returning dimensions for a page that cannot be rendered. A render with `returnPageContent: false` applies the same checks.

```javascript
[
    {
        kind: 'content',
        pageNumber: 1,                      // Page number in the PDF
        name: 'document_page_1.png',        // PNG filename
        content: Buffer<...>,               // PNG image data
                                            //   undefined if returnPageContent=false
        path: '',                           // Empty string for in-memory and metadata results
        width: 612,                         // Image width in pixels (integer; floored from viewportScale)
        height: 792,                        // Image height in pixels (integer; floored from viewportScale)
        rotation: 0                         // Page rotation in degrees: 0, 90, 180, or 270
    },
    // ... more pages
]
```

```javascript
pngPages.forEach((page) => {
    if (page.kind === 'file') {
        console.log(page.path);
    }

    if (page.kind === 'content' && page.content) {
        console.log(page.content.byteLength);
    }
});
```

---

## Migration Guide

Version **4.0.0** introduced public and behavioral changes that existing consumers may need to adopt:

1. **`PngPageOutput` is now discriminated.** Branch on `page.kind` before reading `page.path` or assuming `page.content` is present.
2. **`verbosityLevel` is now typed as `VerbosityLevel`.** Prefer `VerbosityLevel.ERRORS`, `VerbosityLevel.WARNINGS`, or `VerbosityLevel.INFOS` instead of raw numeric literals.
3. **Invalid `pagesToProcess` values now throw early.** `0`, negative numbers, and non-integers are rejected immediately; page numbers above the document length are still ignored.
4. **Disk writes are now exclusive-create (`'wx'`).** Re-running the same conversion into the same output filenames now throws `EEXIST`; clear the target directory or generate unique filenames between runs.

See the [changelog](CHANGELOG.md) for the full release history.

---

## Project Links

- [Changelog](CHANGELOG.md)
- [Contributing Guide](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [Issue Tracker](https://github.com/dichovsky/pdf-to-png-converter/issues)

---

## License

MIT © [dichovsky](https://github.com/dichovsky)

## Buy Me A Coffee

In case you want to support my work:

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/dichovsky)
