# pdf-to-png-converter

<p align="center">
  <strong>🎯 Convert PDF pages to PNG images with zero native dependencies</strong>
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
- ✨ **No Build-Time Compilation** - Pre-built native binaries included, no `node-gyp` or compiler toolchain required
- 🚀 **High Performance** - Supports parallel page processing
- 🔐 **Encrypted PDFs** - Handle password-protected documents
- 📦 **Lightweight** - Minimal dependencies
- 💪 **TypeScript Support** - Full type definitions included
- 🎨 **Flexible Rendering** - Advanced font and rendering options

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Output Format](#output-format)
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

> **Node.js Requirement:** Node.js 20 or higher is required.

---

## Quick Start

Convert a PDF file to PNG images in just a few lines:

```javascript
const { pdfToPng } = require('pdf-to-png-converter');

const pngPages = await pdfToPng('document.pdf', {
    outputFolder: './output',
});

console.log(`Converted ${pngPages.length} pages`);
```

Or with TypeScript:

```typescript
import { pdfToPng, type PngPageOutput } from 'pdf-to-png-converter';

const pngPages: PngPageOutput[] = await pdfToPng('document.pdf', {
    outputFolder: './output',
});
```

---

## API Reference

### `pdfToPng(input, options?)`

Converts PDF pages to PNG images.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `string \| ArrayBufferLike \| Uint8Array` | PDF file path, ArrayBuffer, or Uint8Array/Buffer |
| `options` | `PdfToPngOptions` | Optional configuration object |

**Returns:** `Promise<PngPageOutput[]>` - Array of converted PNG pages

### Options

```javascript
{
    // Font & Rendering Options
    disableFontFace: boolean,        // Disable font face rendering (default: true)
    useSystemFonts: boolean,         // Use system fonts as fallback (default: false)
    enableXfa: boolean,              // Render XFA forms (default: true)
    
    // Output Options
    outputFolder?: string,           // Directory to save PNG files
    outputFileMaskFunc?: (pageNumber: number) => string; // Custom filename function
    
    // Rendering Options
    viewportScale: number,           // PNG scale/zoom level (default: 1.0, max: 100)

    // Security
    pdfFilePassword?: string,        // Password for encrypted PDFs

    // Processing
    pagesToProcess?: number[],       // Pages to convert (1-indexed, e.g., [1, 3, 5])
    processPagesInParallel: boolean, // Enable parallel processing (default: false)
    concurrencyLimit: number,        // Max concurrent pages, positive integer (default: 4)
    
    // Output Control
    returnPageContent: boolean,      // Include PNG buffer in output (default: true)
    returnMetadataOnly: boolean,     // Return only page dimensions/rotation without rendering (default: false)

    // Logging
    verbosityLevel: number,          // 0=ERRORS, 1=WARNINGS, 5=INFOS (default: 0)
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

```javascript
const pngPages = await pdfToPng('document.pdf', {
    // Rendering
    viewportScale: 2.0,              // 2x zoom for higher resolution
    disableFontFace: false,          // Use font face rendering
    useSystemFonts: true,            // Fallback to system fonts
    
    // Output
    outputFolder: './pdf-images',
    outputFileMaskFunc: (pageNumber) => `page-${String(pageNumber).padStart(3, '0')}.png`,
    returnPageContent: true,
    
    // Performance
    processPagesInParallel: true,
    concurrencyLimit: 8,
    
    // Logging
    verbosityLevel: 1,               // Log warnings
});
```

### Convert Specific Pages

```javascript
const pngPages = await pdfToPng('document.pdf', {
    outputFolder: './output',
    pagesToProcess: [1, 3, 5],       // Only convert first, third, and fifth pages
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

const pdfBuffer = fs.readFileSync('document.pdf');
const pngPages = await pdfToPng(pdfBuffer, {
    outputFolder: './output',
    outputFileMaskFunc: (pageNumber) => `page_${pageNumber}.png`,
});
```

### Memory-Efficient Processing

```javascript
// Without returning page content (saves memory for large PDFs)
const pngPages = await pdfToPng('large-document.pdf', {
    outputFolder: './output',
    returnPageContent: false,        // Don't keep PNG buffers in memory
    processPagesInParallel: true,    // Process multiple pages concurrently
    concurrencyLimit: 4,
});

// Pages are written to disk, content property will be undefined
pngPages.forEach(page => {
    console.log(`Saved: ${page.path}`);
});
```

### Get Page Metadata Only

```javascript
// Inspect page dimensions and rotation without rendering any images
const pages = await pdfToPng('document.pdf', {
    returnMetadataOnly: true,
});

pages.forEach(page => {
    console.log(`Page ${page.pageNumber}: ${page.width}x${page.height}px, rotation=${page.rotation}`);
});
```

This is significantly faster than full rendering and useful for checking page counts, dimensions, or orientation before deciding how to process a document.

---

## Output Format

The `pdfToPng` function returns an array of page objects:

```javascript
[
    {
        pageNumber: 1,                      // Page number in the PDF
        name: 'document_page_1.png',        // PNG filename
        content: Buffer<...>,               // PNG image data (or undefined if returnPageContent=false)
        path: '/output/document_page_1.png', // Full file path (empty string if no outputFolder)
        width: 612,                         // Image width in pixels
        height: 792,                        // Image height in pixels
        rotation: 0                         // Page rotation in degrees (0, 90, 180, or 270)
    },
    // ... more pages
]
```

---

## License

MIT © [dichovsky](https://github.com/dichovsky)

## Buy Me A Coffee

In case you want to support my work:

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/dichovsky)
