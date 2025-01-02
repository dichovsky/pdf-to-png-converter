# pdf-to-png-converter

A Node.js utility to convert PDF file/buffer pages to PNG files/buffers without binary and OS dependencies. This utility is ideal for applications that need to process and convert PDF documents into image formats for easier viewing, sharing, or further image processing. It supports various options for rendering fonts, handling encrypted PDFs, and specifying output details, making it a versatile tool for developers working with PDF files in different environments.

[![Tests on push](https://github.com/dichovsky/pdf-to-png-converter/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/dichovsky/pdf-to-png-converter/actions/workflows/test.yml)

## Getting Started

### Package Installation

Installation:

```sh
npm install -D pdf-to-png-converter
```

The installation command uses the -D flag which is typically used for development dependencies. If this package is intended to be used in production, consider using --save instead.

```sh
npm install --save pdf-to-png-converter
```

**Note:** This package requires Node.js version 20 or higher.

## Example

```javascript
const { pdfToPng } = require('pdf-to-png-converter');

test(`Convert PDF To PNG`, async () => {
    const pngPages = await pdfToPng(pdfFilePath, { // The function accepts PDF file path or a Buffer
        disableFontFace: false, // When `false`, fonts will be rendered using a built-in font renderer that constructs the glyphs with primitive path commands. Default value is true.
        useSystemFonts: false, // When `true`, fonts that aren't embedded in the PDF document will fallback to a system font. Default value is false.
        enableXfa: false, // Render Xfa forms if any. Default value is false.
        viewportScale: 2.0, // The desired scale of PNG viewport. Default value is 1.0 which means to display page on the existing canvas with 100% scale.
        outputFolder: 'output/folder', // Folder to write output PNG files. If not specified, PNG output will be available only as a Buffer content, without saving to a file.
        outputFileMaskFunc: (pageNumber) => `page_${pageNumber}.png`, // Output filename mask function. Example: (pageNumber) => `page_${pageNumber}.png`
        pdfFilePassword: 'pa$$word', // Password for encrypted PDF.
        pagesToProcess: [1, 3, 11], // Subset of pages to convert (first page = 1), other pages will be skipped if specified.
        strictPagesToProcess: false, // When `true`, will throw an error if specified page number in pagesToProcess is invalid, otherwise will skip invalid page. Default value is false.
        verbosityLevel: 0, // Verbosity level. ERRORS: 0, WARNINGS: 1, INFOS: 5. Default value is 0.
    });
    // Further processing of pngPages
});
```

## Output

The output of the `pdfToPng` function is an array of objects with the following structure:

```javascript
{
    pageNumber: number; // Page number in PDF file
    name: string; // PNG page name (use outputFileMaskFunc to change it)
    content: Buffer; // PNG page Buffer content
    path: string; // Path to the rendered PNG page file (empty string if outputFolder is not provided)
    width: number; // PNG page width
    height: number; // PNG page height
}
```

## Buy Me A Coffee

In case you want to support my work:

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/dichovsky)
