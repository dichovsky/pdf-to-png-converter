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

Convert PDF files and buffers to PNG images in Node.js. Use this package in web servers, document pipelines, and CLI scripts.

**Key Benefits:**

- ✨ **No Build-Time Compilation** - Uses pre-built native binaries from `@napi-rs/canvas` (no `node-gyp` or compiler toolchain required)
- 🚀 **High Performance** - Supports parallel page processing and worker threads
- 🔐 **Encrypted PDFs** - Converts password-protected PDF documents
- 📦 **Lightweight** - Has minimal runtime dependencies
- 💪 **TypeScript Support** - Ships complete TypeScript declarations
- 🎨 **Flexible Rendering** - Supports custom viewport scaling, page selection, and font options

> **Note:** `@napi-rs/canvas` ships pre-built native binaries for each platform. See the [@napi-rs/canvas repository](https://github.com/Brooooooklyn/canvas) for the list of supported platforms.

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

> **Node.js Requirement:** Node.js 24 or higher is required.

---

## Quick Start

Convert a PDF file to PNG images:

```javascript
const { pdfToPng } = require('pdf-to-png-converter');

(async () => {
    const pngPages = await pdfToPng('document.pdf', {
        outputFolder: './output',
    });

    console.log(`Converted ${pngPages.length} pages`);
})();
```

With TypeScript:

```typescript
import { pdfToPng, VerbosityLevel, type PngPageOutput } from 'pdf-to-png-converter';

const pngPages: PngPageOutput[] = await pdfToPng('document.pdf', {
    outputFolder: './output',
    verbosityLevel: VerbosityLevel.ERRORS, // 0=ERRORS, 1=WARNINGS, 5=INFOS
});
```

> **Existing files are not overwritten.** File writes use exclusive creation (`'wx'`), so an existing target file causes an `EEXIST` error. If a write fails after creating a file (for example, when the disk is full), the library removes that partial file (best effort, only while the path still points to the created file) and rethrows the original error. Pages written before the failure remain on disk. Always use an output directory that untrusted users cannot modify. Within one disk-output call, filenames must be unique after Unicode normalization and case folding (`Page.png` and `page.png`, `straße.png` and `STRASSE.png`, or precomposed and decomposed `é` count as duplicates on every platform). Duplicate filenames and filenames longer than 255 units (UTF-16 code units on macOS and Windows; UTF-8 bytes elsewhere) fail validation before the output folder is created.

---

## CLI Usage

Run the converter from the terminal:

```sh
npx pdf-to-png-converter my-document.pdf --output-folder ./output
```

**Options:**

- `--output-folder <dir>`: Directory where PNG files are saved. Required for image conversion. Existing files are never overwritten (`EEXIST`).
- `--viewport-scale <number>`: Scale factor for each page viewport (default: `1`, maximum: `100`).
- `--use-system-fonts`: Use fonts installed on the host system as a fallback.
- `--disable-font-face <true|false|1|0>`: Draw glyphs as vector paths (default: `true`; embedded fonts are still used). Passing `false` is coerced to `true` and emits process warning `PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED`, because pdf.js has no Font Loading API in Node.js.
- `--enable-xfa <true|false|1|0>`: Render XFA forms.
- `--pdf-file-password <pwd>`: Password for an encrypted PDF. If you omit this flag, the CLI reads the `PDF_TO_PNG_PASSWORD` environment variable (the flag takes precedence, and an empty variable counts as unset). Prefer `PDF_TO_PNG_PASSWORD` loaded from a secret store or CI secret, because command-line flags appear in process lists and shell history (see [SECURITY.md](SECURITY.md)). Quote passwords that contain spaces.
- `--pages-to-process <n,m,...>`: Comma-separated list of 1-based page numbers.
- `--verbosity-level <number>`: pdf.js logging level (`0` = errors, `1` = warnings, `5` = infos). The CLI sends main-thread pdf.js messages to `stderr`; worker threads (`--render-in-worker-threads`) use their own console.
- `--return-metadata-only`: Print page metadata as JSON to `stdout` without rendering images. Does not require `--output-folder`.
- `--process-pages-in-parallel`: Process pages concurrently on the main thread.
- `--concurrency-limit <number>`: Maximum number of concurrent pages or worker threads (default: `4`, valid range: `1..16`).
- `--render-in-worker-threads`: Render pages across worker threads for multi-core parallelism.
- `--silent`: Suppress progress and completion messages. Metadata JSON and errors are still printed.
- `--version`: Print the package version.
- `--help`: Print the help text.

The CLI supports two output modes:

- **Image conversion:** Writes PNG files to `--output-folder`.
- **Metadata inspection:** Prints JSON metadata to `stdout` when `--return-metadata-only` is set (even with `--silent` or `--verbosity-level 5`).

To get PNG buffers in memory, use the library API (`returnPageContent`) instead of the CLI.

Pass exactly one `<pdf-file-path>` to the CLI. Use a shell loop to convert multiple files. Passing a second positional argument (such as `--use-system-fonts false` or an unquoted path with spaces) causes a usage error with exit code 1. The CLI always enforces the 256 MiB input limit; use the library `maxInputBytes` option if you need a different limit.

---

## API Reference

### `pdfToPng(input, options?)`

Converts PDF pages to PNG images or metadata.

**Parameters:**

| Parameter | Type                                      | Description                                      |
| --------- | ----------------------------------------- | ------------------------------------------------ |
| `input`   | `string \| ArrayBufferLike \| Uint8Array` | PDF file path, ArrayBuffer, or Uint8Array/Buffer |
| `options` | `PdfToPngOptions`                         | Optional configuration object                    |

A `string` input is treated as a file path of at most 4096 characters. Longer strings fail before any filesystem access without echoing the string in the error message. Pass PDF bytes as a `Buffer` or `Uint8Array`.

**Returns:** `Promise<PngPageOutput[]>` - Array of page outputs in requested page order.

### Options

```typescript
{
    // Font & Rendering Options
    disableFontFace?: boolean,       // Draw glyphs as paths (default: true); embedded fonts still work.
                                     // Passing false emits process warning PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED
                                     // and uses true, because pdf.js has no Font Loading API in Node.js.
    useSystemFonts?: boolean,        // Use host system fonts as fallback (default: false)
    enableXfa?: boolean,             // Render XFA forms (default: true)

    // Output Options
    outputFolder?: string,           // Directory to save PNG files; existing files are not overwritten.
                                     // Relative paths resolve against process.cwd() when pdfToPng() starts.
                                     // null counts as unset for all options.
    outputFileMaskFunc?: (pageNumber: number) => string, // Custom filename builder.
                                     // Must return a non-empty flat filename without path separators.
                                     // Disk output also rejects NUL, "." / "..", invalid Windows characters/names,
                                     // and names over 255 units (UTF-16 code units on macOS/Windows, UTF-8 bytes elsewhere).

    // Rendering Options
    viewportScale?: number,          // Scale factor (default: 1.0, max: 100).
                                     // Pages exceeding 100,000,000 total pixels or 1,000,000 pixels per side
                                     // fail validation. Reduce viewportScale if a large page exceeds these limits.

    // Security
    pdfFilePassword?: string,        // Password for encrypted PDFs
    maxInputBytes?: number,          // Maximum input PDF size in bytes (default: 256 * 1024 * 1024).
                                     // Caps input bytes for file paths, Buffers, typed arrays, ArrayBuffers,
                                     // SharedArrayBuffers, and byte Arrays. Does not cap pdf.js heap usage.

    // Processing
    pagesToProcess?: number[],       // 1-based integer page numbers to convert (e.g., [1, 3, 5]).
                                     // Must be a non-sparse Array of positive integers; pages above numPages are ignored.
    processPagesInParallel?: boolean, // Enable concurrent processing on the main thread (default: false)
    concurrencyLimit?: number,       // Max concurrent pages or worker-pool size: integer 1..16 (default: 4)
    renderInWorkerThreads?: boolean, // Render pages in a pool of worker threads (default: false).
                                     // Requires the unbundled installed package (see Troubleshooting).
                                     // Worker errors preserve message, name, and cause as native Errors.

    // Output Control
    returnPageContent?: boolean,     // Include PNG Buffer in each result object (default: true)
    returnMetadataOnly?: boolean,    // Return only page dimensions and rotation without rendering (default: false)

    // Logging
    verbosityLevel?: VerbosityLevel, // VerbosityLevel.ERRORS | WARNINGS | INFOS (default: ERRORS).
                                     // Shared per thread in pdf.js; changes log output only.
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
    pagesToProcess: [1, 3, 5], // Convert only pages 1, 3, and 5
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
// Omit PNG buffers from the return value to reduce memory usage on large PDFs
const pngPages = await pdfToPng('large-document.pdf', {
    outputFolder: './output',
    returnPageContent: false,
    processPagesInParallel: true,
    concurrencyLimit: 4,
});

pngPages.forEach((page) => {
    if (page.kind === 'file') {
        console.log(`Saved: ${page.path}`);
    }
});
```

### Get Page Metadata Only

```javascript
// Inspect page dimensions and rotation without rendering images
const pages = await pdfToPng('document.pdf', {
    returnMetadataOnly: true,
});

pages.forEach((page) => {
    console.log(`Page ${page.pageNumber}: ${page.width}x${page.height}px, rotation=${page.rotation}`);
});
```

Metadata mode skips image rendering and is useful for checking page counts, dimensions, or orientation before converting a document.

---

## Performance Notes

- **Pipelined processing:** PNG encoding runs on the libuv threadpool and overlaps subsequent page renders. Files can finish writing out of page order even in default mode. Read results from the returned array, which always preserves the requested page order.
- **Threadpool sizing:** PNG encoding and file writes share Node's libuv threadpool (4 threads by default). On multi-core machines, increasing the pool size can improve throughput for parallel file output: `UV_THREADPOOL_SIZE=8 node app.js`.
- **Strict serial processing:** To keep at most one page in flight at a time, set `processPagesInParallel: true` and `concurrencyLimit: 1`.
- **Multi-core rendering:** `processPagesInParallel` interleaves asynchronous work on the main thread, so rasterization itself remains single-threaded. Set `renderInWorkerThreads: true` to rasterize pages across a pool of worker threads (`concurrencyLimit` sets the maximum pool size). Each worker keeps its own PDF copy and pdf.js instance, and the main thread keeps one extra copy of the PDF bytes during the conversion. Use worker threads for multi-page, render-heavy PDFs.
- **Large images and untrusted PDFs:** Embedded images consume memory and CPU time based on their declared pixel dimensions, not the PDF file size:
    - **Memory:** pdf.js decodes each embedded image (Flate, JPEG, CCITT, JBIG2, or JPEG 2000) into a temporary canvas that uses about 8 bytes per declared pixel on the rendering thread. JPEG 2000 images above pdf.js's internal threshold decode at a reduced resolution first.
    - **Time:** Decode time increases super-linearly with image pixel count.
    - **Maximum image canvas size:** An image declared at roughly 537 million pixels or more (for example, a 600 dpi A0 scan at 19866×28087) requires a canvas of 2 GiB or more (4 bytes per pixel). For Flate, JPEG, CCITT, and JBIG2 images, `@napi-rs/canvas` allocates that canvas but ignores all drawing operations on it, so the image is missing from the rendered page with no error or warning. JPEG 2000 images above pdf.js's internal limit are decoded at reduced resolution with a warning at `VerbosityLevel.WARNINGS`.
    - **WebAssembly decoders:** CCITT, JBIG2, and JPEG 2000 decoders run in WebAssembly with a 2 GiB heap limit per decoder instance per thread.
    - **Limits:** Neither `maxInputBytes` nor `MAX_CANVAS_PIXELS` limits the declared pixel dimensions of an image inside a PDF. Enforce container memory limits and per-job timeouts when processing untrusted PDFs.
    - **Corrupt and non-PDF input:** `maxInputBytes` limits input file size, not pdf.js heap memory. When pdf.js rebuilds a damaged cross-reference table, a long run of identical bytes (such as zeros) can use 32 to 64 bytes of heap per input byte and trigger a fatal `JavaScript heap out of memory` abort. Process untrusted PDFs in an isolated child process with `--max-old-space-size`, or in a dedicated `Worker` with `resourceLimits`.
    - **Concurrency:** On the main thread, pdf.js decodes images sequentially, so peak image memory stays close to a single image regardless of `concurrencyLimit`. With `renderInWorkerThreads: true`, workers decode images in parallel, multiplying peak memory by the number of active workers; reduce `concurrencyLimit` to bound memory usage.

---

## Troubleshooting

- **A scanned page renders blank:** pdf.js logs image decode failures as warnings and renders the rest of the page. Run with `verbosityLevel: VerbosityLevel.WARNINGS` (CLI: `--verbosity-level 1`) and check for `Unable to decode image`. If no warning appears, check whether the embedded image declares 537 million pixels or more (see [Performance Notes](#performance-notes)). Run the conversion alone on the thread so another concurrent conversion does not overwrite `verbosityLevel`.
- **`PDF_TO_PNG_WASM_MISSING` process warning:** `jbig2.wasm` or `openjpeg.wasm` is missing from the `wasm` directory of the installed `pdfjs-dist` package. Without these files, CCITT, JBIG2, and JPEG 2000 images can render blank or decode slowly through the JavaScript fallback. Reinstall your dependencies to restore the files. To silence only this warning, pass `--disable-warning=PDF_TO_PNG_WASM_MISSING` to Node or `NODE_OPTIONS`.
- **`PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED` process warning:** You passed `disableFontFace: false` (or `--disable-font-face false`). Because pdf.js has no Font Loading API in Node.js, the library ignores `false` and uses `true`. Remove the option, or pass `--disable-warning=PDF_TO_PNG_DISABLE_FONT_FACE_IGNORED` to silence the warning.
- **`Cannot resolve "pdfjs-dist/package.json"`:** The library resolves `cmaps`, `standard_fonts`, and `wasm` from the installed `pdfjs-dist` package. Ensure `pdfjs-dist` is installed in `node_modules` and not inlined by a bundler.
- **`renderInWorkerThreads` cannot locate `pageRenderWorker.js` because `__dirname` is not defined:** Worker mode loads `pageRenderWorker.js` from the unbundled `out/` directory using `__dirname`. Load `pdf-to-png-converter` as an external package from `node_modules` instead of bundling it into an ESM bundle, or set `renderInWorkerThreads: false`.

---

## Output Format

`pdfToPng` returns an array of discriminated `PngPageOutput` objects. Check `page.kind` before accessing mode-specific properties:

| `kind`     | When returned                    | `path`    | `content`                                       |
| ---------- | -------------------------------- | --------- | ----------------------------------------------- |
| `metadata` | `returnMetadataOnly: true`       | `''`      | `undefined`                                     |
| `content`  | Rendering without `outputFolder` | `''`      | PNG `Buffer`, unless `returnPageContent: false` |
| `file`     | Rendering with `outputFolder`    | File path | PNG `Buffer`, unless `returnPageContent: false` |

Every output object includes `pageNumber`, `name`, `width`, `height`, and `rotation`. `width` and `height` are integer pixel dimensions: fractional viewport sizes floor to the next lower integer, except sizes within `1e-6` px below a whole number round up to that whole number so floating-point inaccuracy does not lose 1 pixel. `returnMetadataOnly` and `returnPageContent: false` apply the same dimension rules and reject pages that floor to `0` px, exceed 100,000,000 total pixels, or exceed 1,000,000 pixels on a side.

```javascript
[
    {
        kind: 'content',
        pageNumber: 1,                      // 1-based page number in the PDF
        name: 'document_page_1.png',        // Resolved PNG filename
        content: Buffer<...>,               // PNG image data (undefined if returnPageContent is false)
        path: '',                           // Empty string for content and metadata results
        width: 612,                         // Image width in pixels (integer)
        height: 792,                        // Image height in pixels (integer)
        rotation: 0                         // Page rotation in degrees: 0, 90, 180, or 270
    },
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

Version **4.0.0** introduced breaking changes:

1. **`PngPageOutput` is a discriminated union:** Check `page.kind` before reading `page.path` or `page.content`.
2. **`verbosityLevel` uses `VerbosityLevel`:** Pass `VerbosityLevel.ERRORS`, `VerbosityLevel.WARNINGS`, or `VerbosityLevel.INFOS`.
3. **Invalid `pagesToProcess` values throw immediately:** `0`, negative numbers, non-integers, non-arrays, and sparse arrays throw an error before I/O. Page numbers above the document page count are still ignored.
4. **Disk writes use exclusive creation (`'wx'`):** Writing to an existing file path throws `EEXIST`. Clean the output directory or generate unique filenames before each run.

See [CHANGELOG.md](CHANGELOG.md) for the complete release history.

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

Support this project:

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/dichovsky)
