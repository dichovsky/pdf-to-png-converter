# pdf-to-png-converter

Node.js utility to compare PNG files without binary and OS dependencies.  

[![Tests on push](https://github.com/dichovsky/pdf-to-png-converter/actions/workflows/main.yml/badge.svg?branch=main)](https://github.com/dichovsky/pdf-to-png-converter/actions/workflows/main.yml)

## Getting started

Installation:

```sh
npm install -D pdf-to-png-converter
```

## Example

```javascript
test(`Convert PDF To PNG`, async () => {
    const pngPages: PngPageOutput[] = await pdfToPng(pdfFilePath, { // The function accepts PDF file path or a Buffer
        disableFontFace: false, // If disabled, fonts will be rendered using a built-in font renderer that constructs the glyphs with primitive path commands.
        useSystemFonts: false, // When `true`, fonts that aren't embedded in the PDF document will fallback to a system font.
        viewportScale: 2.0, // The desired scale of PNG viewport
        outputFilesFolder: 'output/folder', // folder to write output png files,
        pdfFilePassword: 'password', // password for encrypted PDF
    });

   ...
});
```

### Output

```javascript
{
    name: string; // PNG page name in a format `{pdfFileName}_page_{pdfPageNumber}.png`,
    content: Buffer; // PNG page content
    path: string; // path to stored PNG file (empty string if outputFilesFolder is not provided)
};
```
