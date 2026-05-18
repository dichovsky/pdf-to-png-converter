# CODEMAP

Machine-readable symbol index for coding agents. Regenerate with `npm run codemap`.
Verified by `npm run codemap:check` (CI). Do not hand-edit.

```json
{
  "schema": "codemap.v2",
  "repo": {
    "name": "pdf-to-png-converter",
    "version": "4.0.0"
  },
  "sourceHash": "256159348bba9675dd057b6acdfd2070eec1d11a216772957dc976068582b7b3",
  "entrypoints": [
    "src/index.ts"
  ],
  "publicApi": [
    {
      "name": "PdfToPngOptions",
      "kind": "interface",
      "file": "src/interfaces/pdf.to.png.options.ts",
      "line": 9,
      "signature": "export interface PdfToPngOptions { viewportScale?: number; disableFontFace?: boolean; useSystemFonts?: boolean; enableXfa?: boolean; pdfFilePassword?: string; outputFolder?: string; outputFileMaskFunc…",
      "jsdoc": "Options for the `pdfToPng` conversion function.",
      "typeOnly": true
    },
    {
      "name": "PngPageOutput",
      "kind": "type",
      "file": "src/interfaces/png.page.output.ts",
      "line": 29,
      "signature": "export type PngPageOutput = MetadataPngPageOutput | InMemoryPngPageOutput | FilePngPageOutput;",
      "jsdoc": "",
      "typeOnly": true
    },
    {
      "name": "VerbosityLevel",
      "kind": "enum",
      "file": "src/types/verbosity.level.ts",
      "line": 8,
      "signature": "export enum VerbosityLevel { ERRORS = 0, WARNINGS = 1, INFOS = 5, }",
      "jsdoc": "Verbosity levels for the pdfjs-dist logger, passed via `PdfToPngOptions.verbosityLevel`.",
      "typeOnly": false
    },
    {
      "name": "pdfToPng",
      "kind": "function",
      "file": "src/pdfToPng.ts",
      "line": 16,
      "signature": "export async function pdfToPng(pdfFile: string | ArrayBufferLike | Uint8Array, props?: PdfToPngOptions): Promise<PngPageOutput[]>",
      "jsdoc": "Convert PDF pages to PNG buffers and/or files.",
      "typeOnly": false
    }
  ],
  "files": [
    {
      "path": "src/cli.ts",
      "symbols": [
        {
          "name": "HELP_TEXT",
          "kind": "variable",
          "line": 14,
          "exported": true,
          "signature": "export const HELP_TEXT = `Usage: pdf-to-png-converter <pdf-file-path> [options]\n\nOptions:\n  --output-folder <dir>             Folder path where PNG files will be written\n  --viewport-scale <number>   …"
        },
        {
          "name": "CLI_OPTIONS",
          "kind": "variable",
          "line": 38,
          "exported": false,
          "signature": "const CLI_OPTIONS = { 'output-folder': { type: 'string' }, 'viewport-scale': { type: 'string' }, 'use-system-fonts': { type: 'boolean' }, 'disable-font-face': { type: 'string' }, 'enable-xfa': { type:…"
        },
        {
          "name": "ParsedValues",
          "kind": "type",
          "line": 56,
          "exported": false,
          "signature": "type ParsedValues = { 'output-folder'?: string; 'viewport-scale'?: string; 'use-system-fonts'?: boolean; 'disable-font-face'?: string; 'enable-xfa'?: string; 'pdf-file-password'?: string; 'pages-to-pr…"
        },
        {
          "name": "CliParseResult",
          "kind": "type",
          "line": 74,
          "exported": false,
          "signature": "type CliParseResult = { values: ParsedValues; positionals: string[] };"
        },
        {
          "name": "parseBoolean",
          "kind": "function",
          "line": 85,
          "exported": true,
          "signature": "export function parseBoolean(val: string | undefined): boolean | undefined"
        },
        {
          "name": "parseNumberList",
          "kind": "function",
          "line": 99,
          "exported": true,
          "signature": "export function parseNumberList(val: string | undefined): number[] | undefined"
        },
        {
          "name": "parseNumericOption",
          "kind": "function",
          "line": 110,
          "exported": false,
          "signature": "function parseNumericOption(value: string | undefined, errorMessage: string): number | undefined"
        },
        {
          "name": "parseIntegerOption",
          "kind": "function",
          "line": 123,
          "exported": false,
          "signature": "function parseIntegerOption(value: string | undefined, errorMessage: string): number | undefined"
        },
        {
          "name": "safeParseArgs",
          "kind": "function",
          "line": 136,
          "exported": false,
          "signature": "function safeParseArgs(): CliParseResult | null"
        },
        {
          "name": "buildPdfToPngOptions",
          "kind": "function",
          "line": 153,
          "exported": true,
          "signature": "export function buildPdfToPngOptions( values: ParsedValues, positionals: string[], ): { pdfFilePath: string; options: NormalizedPdfToPngOptions }"
        },
        {
          "name": "executeConversion",
          "kind": "function",
          "line": 183,
          "exported": true,
          "signature": "export async function executeConversion( pdfFilePath: string, options: NormalizedPdfToPngOptions, log: (...msgs: unknown[]) => void, ): Promise<void>"
        },
        {
          "name": "createLogger",
          "kind": "function",
          "line": 204,
          "exported": false,
          "signature": "function createLogger(silent: boolean | undefined): (...msgs: unknown[]) => void"
        },
        {
          "name": "handleRunError",
          "kind": "function",
          "line": 210,
          "exported": false,
          "signature": "function handleRunError(err: unknown): void"
        },
        {
          "name": "getVersion",
          "kind": "function",
          "line": 229,
          "exported": true,
          "signature": "export function getVersion(): string"
        },
        {
          "name": "run",
          "kind": "function",
          "line": 249,
          "exported": true,
          "signature": "export async function run(): Promise<void>"
        }
      ],
      "imports": [
        {
          "from": "./interfaces/pdf.to.png.options.js",
          "names": [
            "PdfToPngOptions"
          ]
        },
        {
          "from": "./normalizePdfToPngOptions.js",
          "names": [
            "NormalizedPdfToPngOptions",
            "normalizePdfToPngOptions"
          ]
        },
        {
          "from": "./pdfToPngCore.js",
          "names": [
            "pdfToPngCore"
          ]
        },
        {
          "from": "node:fs",
          "names": [
            "default"
          ]
        },
        {
          "from": "node:path",
          "names": [
            "default"
          ]
        },
        {
          "from": "node:util",
          "names": [
            "parseArgs"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/const.ts",
      "symbols": [
        {
          "name": "MAX_VIEWPORT_SCALE",
          "kind": "variable",
          "line": 8,
          "exported": true,
          "signature": "export const MAX_VIEWPORT_SCALE = 100"
        },
        {
          "name": "MAX_CANVAS_PIXELS",
          "kind": "variable",
          "line": 14,
          "exported": true,
          "signature": "export const MAX_CANVAS_PIXELS = 100_000_000"
        },
        {
          "name": "MAX_INPUT_BYTES",
          "kind": "variable",
          "line": 23,
          "exported": true,
          "signature": "export const MAX_INPUT_BYTES = 256 * 1024 * 1024"
        },
        {
          "name": "MAX_CONCURRENCY_LIMIT",
          "kind": "variable",
          "line": 31,
          "exported": true,
          "signature": "export const MAX_CONCURRENCY_LIMIT = 16"
        },
        {
          "name": "PDF_TO_PNG_OPTIONS_DEFAULTS",
          "kind": "variable",
          "line": 37,
          "exported": true,
          "signature": "export const PDF_TO_PNG_OPTIONS_DEFAULTS = { viewportScale: 1, disableFontFace: true, useSystemFonts: false, enableXfa: true, outputFileMask: 'buffer', pdfFilePassword: undefined, concurrencyLimit: 4,…"
        },
        {
          "name": "CMAP_RELATIVE_URL",
          "kind": "variable",
          "line": 56,
          "exported": true,
          "signature": "export const CMAP_RELATIVE_URL = './node_modules/pdfjs-dist/cmaps/'"
        },
        {
          "name": "STANDARD_FONTS_RELATIVE_URL",
          "kind": "variable",
          "line": 57,
          "exported": true,
          "signature": "export const STANDARD_FONTS_RELATIVE_URL = './node_modules/pdfjs-dist/standard_fonts/'"
        },
        {
          "name": "DOCUMENT_INIT_PARAMS_DEFAULTS",
          "kind": "variable",
          "line": 69,
          "exported": true,
          "signature": "export const DOCUMENT_INIT_PARAMS_DEFAULTS: DocumentInitParameters = { cMapUrl: CMAP_RELATIVE_URL, cMapPacked: true, standardFontDataUrl: STANDARD_FONTS_RELATIVE_URL, }"
        }
      ],
      "imports": [
        {
          "from": "pdfjs-dist/types/src/display/api",
          "names": [
            "DocumentInitParameters"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/filesystemSink.ts",
      "symbols": [
        {
          "name": "FilesystemSink",
          "kind": "class",
          "line": 4,
          "exported": true,
          "signature": "export class FilesystemSink implements OutputSink {",
          "members": [
            {
              "name": "constructor",
              "kind": "constructor",
              "line": 5
            },
            {
              "name": "write",
              "kind": "method",
              "line": 10
            }
          ]
        }
      ],
      "imports": [
        {
          "from": "./interfaces/output.sink.js",
          "names": [
            "OutputSink"
          ]
        },
        {
          "from": "./outputWriter.js",
          "names": [
            "savePNGfile"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/index.ts",
      "symbols": [],
      "imports": [],
      "reExports": [
        {
          "from": "./interfaces/index.js",
          "name": "PdfToPngOptions",
          "typeOnly": true
        },
        {
          "from": "./interfaces/index.js",
          "name": "PngPageOutput",
          "typeOnly": true
        },
        {
          "from": "./pdfToPng.js",
          "name": "pdfToPng",
          "typeOnly": false
        },
        {
          "from": "./types/index.js",
          "name": "VerbosityLevel",
          "typeOnly": false
        }
      ]
    },
    {
      "path": "src/interfaces/canvas.and.context.ts",
      "symbols": [
        {
          "name": "CanvasAndContext",
          "kind": "interface",
          "line": 10,
          "exported": true,
          "signature": "export interface CanvasAndContext { canvas: Canvas | null; context: SKRSContext2D | null; }"
        }
      ],
      "imports": [
        {
          "from": "@napi-rs/canvas",
          "names": [
            "Canvas",
            "SKRSContext2D"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/interfaces/index.ts",
      "symbols": [],
      "imports": [],
      "reExports": [
        {
          "from": "./canvas.and.context.js",
          "name": "CanvasAndContext",
          "typeOnly": true
        },
        {
          "from": "./pdf.to.png.options.js",
          "name": "PdfToPngOptions",
          "typeOnly": true
        },
        {
          "from": "./png.page.output.js",
          "name": "FilePngPageOutput",
          "typeOnly": true
        },
        {
          "from": "./png.page.output.js",
          "name": "InMemoryPngPageOutput",
          "typeOnly": true
        },
        {
          "from": "./png.page.output.js",
          "name": "MetadataPngPageOutput",
          "typeOnly": true
        },
        {
          "from": "./png.page.output.js",
          "name": "PageRotation",
          "typeOnly": true
        },
        {
          "from": "./png.page.output.js",
          "name": "PngPageOutput",
          "typeOnly": true
        }
      ]
    },
    {
      "path": "src/interfaces/output.sink.ts",
      "symbols": [
        {
          "name": "OutputSink",
          "kind": "interface",
          "line": 1,
          "exported": true,
          "signature": "export interface OutputSink { write(name: string, content: Buffer): Promise<string>; }"
        }
      ],
      "imports": [],
      "reExports": []
    },
    {
      "path": "src/interfaces/pdf.to.png.options.ts",
      "symbols": [
        {
          "name": "PdfToPngOptions",
          "kind": "interface",
          "line": 9,
          "exported": true,
          "signature": "export interface PdfToPngOptions { viewportScale?: number; disableFontFace?: boolean; useSystemFonts?: boolean; enableXfa?: boolean; pdfFilePassword?: string; outputFolder?: string; outputFileMaskFunc…"
        }
      ],
      "imports": [
        {
          "from": "../types/index.js",
          "names": [
            "VerbosityLevel"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/interfaces/png.page.output.ts",
      "symbols": [
        {
          "name": "PageRotation",
          "kind": "type",
          "line": 1,
          "exported": true,
          "signature": "export type PageRotation = 0 | 90 | 180 | 270;"
        },
        {
          "name": "BasePngPageOutput",
          "kind": "interface",
          "line": 3,
          "exported": false,
          "signature": "interface BasePngPageOutput { pageNumber: number; name: string; width: number; height: number; rotation: PageRotation; }"
        },
        {
          "name": "MetadataPngPageOutput",
          "kind": "interface",
          "line": 11,
          "exported": true,
          "signature": "export interface MetadataPngPageOutput extends BasePngPageOutput { kind: 'metadata'; content: undefined; path: ''; }"
        },
        {
          "name": "InMemoryPngPageOutput",
          "kind": "interface",
          "line": 17,
          "exported": true,
          "signature": "export interface InMemoryPngPageOutput extends BasePngPageOutput { kind: 'content'; content: Buffer | undefined; path: ''; }"
        },
        {
          "name": "FilePngPageOutput",
          "kind": "interface",
          "line": 23,
          "exported": true,
          "signature": "export interface FilePngPageOutput extends BasePngPageOutput { kind: 'file'; content: Buffer | undefined; path: string; }"
        },
        {
          "name": "PngPageOutput",
          "kind": "type",
          "line": 29,
          "exported": true,
          "signature": "export type PngPageOutput = MetadataPngPageOutput | InMemoryPngPageOutput | FilePngPageOutput;"
        }
      ],
      "imports": [],
      "reExports": []
    },
    {
      "path": "src/node.canvas.factory.ts",
      "symbols": [
        {
          "name": "NodeCanvasFactory",
          "kind": "class",
          "line": 15,
          "exported": true,
          "signature": "export class NodeCanvasFactory {",
          "members": [
            {
              "name": "create",
              "kind": "method",
              "line": 24
            },
            {
              "name": "reset",
              "kind": "method",
              "line": 46
            },
            {
              "name": "destroy",
              "kind": "method",
              "line": 64
            }
          ]
        }
      ],
      "imports": [
        {
          "from": "./interfaces",
          "names": [
            "CanvasAndContext"
          ]
        },
        {
          "from": "@napi-rs/canvas",
          "names": [
            "Canvas"
          ]
        },
        {
          "from": "node:assert",
          "names": [
            "assert"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/normalizePath.ts",
      "symbols": [
        {
          "name": "normalizePath",
          "kind": "function",
          "line": 21,
          "exported": true,
          "signature": "export function normalizePath(path: string): string"
        }
      ],
      "imports": [
        {
          "from": "node:path",
          "names": [
            "normalize",
            "resolve",
            "sep"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/normalizePdfToPngOptions.ts",
      "symbols": [
        {
          "name": "NormalizedPdfToPngOptions",
          "kind": "interface",
          "line": 5,
          "exported": true,
          "signature": "export interface NormalizedPdfToPngOptions { viewportScale: number; disableFontFace: boolean; useSystemFonts: boolean; enableXfa: boolean; pdfFilePassword: string | undefined; outputFolder: string | u…"
        },
        {
          "name": "normalizePdfToPngOptions",
          "kind": "function",
          "line": 22,
          "exported": true,
          "signature": "export function normalizePdfToPngOptions(props: PdfToPngOptions | undefined): NormalizedPdfToPngOptions"
        }
      ],
      "imports": [
        {
          "from": "./const.js",
          "names": [
            "MAX_CONCURRENCY_LIMIT",
            "MAX_VIEWPORT_SCALE",
            "PDF_TO_PNG_OPTIONS_DEFAULTS"
          ]
        },
        {
          "from": "./interfaces/pdf.to.png.options.js",
          "names": [
            "PdfToPngOptions"
          ]
        },
        {
          "from": "./types/verbosity.level.js",
          "names": [
            "VerbosityLevel"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/nullSink.ts",
      "symbols": [
        {
          "name": "NullSink",
          "kind": "class",
          "line": 3,
          "exported": true,
          "signature": "export class NullSink implements OutputSink {",
          "members": [
            {
              "name": "write",
              "kind": "method",
              "line": 4
            }
          ]
        }
      ],
      "imports": [
        {
          "from": "./interfaces/output.sink.js",
          "names": [
            "OutputSink"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/outputWriter.ts",
      "symbols": [
        {
          "name": "PATH_SEPARATOR_PATTERN",
          "kind": "variable",
          "line": 8,
          "exported": false,
          "signature": "const PATH_SEPARATOR_PATTERN = sep === '\\\\' ? /[\\\\/]/ : /\\"
        },
        {
          "name": "SEPARATOR_DESCRIPTION",
          "kind": "variable",
          "line": 9,
          "exported": false,
          "signature": "const SEPARATOR_DESCRIPTION = sep === '\\\\' ? '\"/\" or \"\\\\\"' : '\"/\"'"
        },
        {
          "name": "isEscapingRelativePath",
          "kind": "function",
          "line": 11,
          "exported": false,
          "signature": "function isEscapingRelativePath(rel: string): boolean"
        },
        {
          "name": "savePNGfile",
          "kind": "function",
          "line": 29,
          "exported": true,
          "signature": "export async function savePNGfile(name: string, content: Buffer, resolvedOutputFolder: string, realOutputFolder: string): Promise<string>"
        }
      ],
      "imports": [
        {
          "from": "node:fs",
          "names": [
            "fsPromises"
          ]
        },
        {
          "from": "node:path",
          "names": [
            "dirname",
            "isAbsolute",
            "join",
            "relative",
            "sep"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/pageOrchestrator.ts",
      "symbols": [
        {
          "name": "PATH_SEPARATOR_PATTERN",
          "kind": "variable",
          "line": 11,
          "exported": false,
          "signature": "const PATH_SEPARATOR_PATTERN = sep === '\\\\' ? /[\\\\/]/ : /\\"
        },
        {
          "name": "SEPARATOR_DESCRIPTION",
          "kind": "variable",
          "line": 12,
          "exported": false,
          "signature": "const SEPARATOR_DESCRIPTION = sep === '\\\\' ? '\"/\" or \"\\\\\"' : '\"/\"'"
        },
        {
          "name": "assertFlatFilename",
          "kind": "function",
          "line": 14,
          "exported": false,
          "signature": "function assertFlatFilename(name: string, pageNumber: number): void"
        },
        {
          "name": "resolvePageName",
          "kind": "function",
          "line": 22,
          "exported": true,
          "signature": "export function resolvePageName( pageNumber: number, defaultMask: string, outputFileMaskFunc: ((page: number) => string) | undefined, ): string"
        },
        {
          "name": "processAndSavePage",
          "kind": "function",
          "line": 43,
          "exported": true,
          "signature": "export async function processAndSavePage( pdfDocument: PDFDocumentProxy, pageName: string, pageNumber: number, pageViewportScale: number, shouldReturnContent: boolean, returnMetadataOnly: boolean, out…"
        }
      ],
      "imports": [
        {
          "from": "./interfaces/index.js",
          "names": [
            "FilePngPageOutput",
            "PngPageOutput"
          ]
        },
        {
          "from": "./interfaces/output.sink.js",
          "names": [
            "OutputSink"
          ]
        },
        {
          "from": "./pageRenderer.js",
          "names": [
            "getPageMetadata",
            "renderPdfPage"
          ]
        },
        {
          "from": "node:path",
          "names": [
            "sep"
          ]
        },
        {
          "from": "pdfjs-dist",
          "names": [
            "PDFDocumentProxy"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/pageRenderer.ts",
      "symbols": [
        {
          "name": "isNodeCanvasFactory",
          "kind": "function",
          "line": 6,
          "exported": false,
          "signature": "function isNodeCanvasFactory(factory: unknown): factory is NodeCanvasFactory"
        },
        {
          "name": "normalizeRotation",
          "kind": "function",
          "line": 10,
          "exported": true,
          "signature": "export function normalizeRotation(raw: number): PageRotation"
        },
        {
          "name": "getPageMetadata",
          "kind": "function",
          "line": 26,
          "exported": true,
          "signature": "export async function getPageMetadata( pdf: PDFDocumentProxy, pageName: string, pageNumber: number, pageViewportScale: number, ): Promise<MetadataPngPageOutput>"
        },
        {
          "name": "renderPdfPage",
          "kind": "function",
          "line": 51,
          "exported": true,
          "signature": "export async function renderPdfPage( pdf: PDFDocumentProxy, pageName: string, pageNumber: number, pageViewportScale: number, returnPageContent: boolean, ): Promise<InMemoryPngPageOutput>"
        }
      ],
      "imports": [
        {
          "from": "./const.js",
          "names": [
            "MAX_CANVAS_PIXELS"
          ]
        },
        {
          "from": "./interfaces/index.js",
          "names": [
            "InMemoryPngPageOutput",
            "MetadataPngPageOutput",
            "PageRotation"
          ]
        },
        {
          "from": "./node.canvas.factory.js",
          "names": [
            "NodeCanvasFactory"
          ]
        },
        {
          "from": "pdfjs-dist",
          "names": [
            "PDFDocumentProxy"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/pdfInput.ts",
      "symbols": [
        {
          "name": "rejectOversized",
          "kind": "function",
          "line": 3,
          "exported": false,
          "signature": "function rejectOversized(byteLength: number, maxInputBytes: number): void"
        },
        {
          "name": "getPdfFileBuffer",
          "kind": "function",
          "line": 9,
          "exported": true,
          "signature": "export async function getPdfFileBuffer( pdfFile: string | ArrayBufferLike | Uint8Array, maxInputBytes: number, ): Promise<Uint8Array | ArrayBufferLike>"
        }
      ],
      "imports": [
        {
          "from": "node:fs",
          "names": [
            "fsPromises"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/pdfToPng.ts",
      "symbols": [
        {
          "name": "pdfToPng",
          "kind": "function",
          "line": 16,
          "exported": true,
          "signature": "export async function pdfToPng(pdfFile: string | ArrayBufferLike | Uint8Array, props?: PdfToPngOptions): Promise<PngPageOutput[]>"
        }
      ],
      "imports": [
        {
          "from": "./interfaces/index.js",
          "names": [
            "PdfToPngOptions",
            "PngPageOutput"
          ]
        },
        {
          "from": "./normalizePdfToPngOptions.js",
          "names": [
            "normalizePdfToPngOptions"
          ]
        },
        {
          "from": "./pdfToPngCore.js",
          "names": [
            "pdfToPngCore"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/pdfToPngCore.ts",
      "symbols": [
        {
          "name": "processPagesWithSlidingWindow",
          "kind": "function",
          "line": 14,
          "exported": false,
          "signature": "async function processPagesWithSlidingWindow<T>( pageNumbers: number[], concurrencyLimit: number, processPage: (pageNumber: number) => Promise<T>, ): Promise<T[]>"
        },
        {
          "name": "pdfToPngCore",
          "kind": "function",
          "line": 55,
          "exported": true,
          "signature": "export async function pdfToPngCore( pdfFile: string | ArrayBufferLike | Uint8Array, normalizedProps: NormalizedPdfToPngOptions, ): Promise<PngPageOutput[]>"
        }
      ],
      "imports": [
        {
          "from": "./const.js",
          "names": [
            "PDF_TO_PNG_OPTIONS_DEFAULTS"
          ]
        },
        {
          "from": "./filesystemSink.js",
          "names": [
            "FilesystemSink"
          ]
        },
        {
          "from": "./interfaces/index.js",
          "names": [
            "PngPageOutput"
          ]
        },
        {
          "from": "./interfaces/output.sink.js",
          "names": [
            "OutputSink"
          ]
        },
        {
          "from": "./normalizePdfToPngOptions.js",
          "names": [
            "NormalizedPdfToPngOptions"
          ]
        },
        {
          "from": "./nullSink.js",
          "names": [
            "NullSink"
          ]
        },
        {
          "from": "./pageOrchestrator.js",
          "names": [
            "processAndSavePage",
            "resolvePageName"
          ]
        },
        {
          "from": "./pdfInput.js",
          "names": [
            "getPdfFileBuffer"
          ]
        },
        {
          "from": "./pdfjsLoader.js",
          "names": [
            "getPdfDocument"
          ]
        },
        {
          "from": "node:fs",
          "names": [
            "fsPromises"
          ]
        },
        {
          "from": "node:path",
          "names": [
            "parse",
            "resolve"
          ]
        },
        {
          "from": "pdfjs-dist",
          "names": [
            "PDFDocumentProxy"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/pdfjsLoader.ts",
      "symbols": [
        {
          "name": "pdfjsLib",
          "kind": "variable",
          "line": 6,
          "exported": false,
          "signature": "let pdfjsLib: typeof PdfjsModule | undefined"
        },
        {
          "name": "getPdfDocument",
          "kind": "function",
          "line": 8,
          "exported": true,
          "signature": "export async function getPdfDocument( pdfFileBuffer: Uint8Array | ArrayBufferLike, opts: NormalizedPdfToPngOptions, ): Promise<PDFDocumentProxy>"
        }
      ],
      "imports": [
        {
          "from": "./normalizePdfToPngOptions.js",
          "names": [
            "NormalizedPdfToPngOptions"
          ]
        },
        {
          "from": "./propsToPdfDocInitParams.js",
          "names": [
            "propsToPdfDocInitParams"
          ]
        },
        {
          "from": "pdfjs-dist",
          "names": [
            "PDFDocumentLoadingTask",
            "PDFDocumentProxy"
          ]
        },
        {
          "from": "pdfjs-dist/legacy/build/pdf.mjs",
          "names": [
            "*"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/propsToPdfDocInitParams.ts",
      "symbols": [
        {
          "name": "propsToPdfDocInitParams",
          "kind": "function",
          "line": 26,
          "exported": true,
          "signature": "export function propsToPdfDocInitParams(opts: NormalizedPdfToPngOptions): pdfApiTypes.DocumentInitParameters"
        }
      ],
      "imports": [
        {
          "from": "./const.js",
          "names": [
            "CMAP_RELATIVE_URL",
            "DOCUMENT_INIT_PARAMS_DEFAULTS",
            "STANDARD_FONTS_RELATIVE_URL"
          ]
        },
        {
          "from": "./normalizePath.js",
          "names": [
            "normalizePath"
          ]
        },
        {
          "from": "./normalizePdfToPngOptions.js",
          "names": [
            "NormalizedPdfToPngOptions"
          ]
        },
        {
          "from": "pdfjs-dist/types/src/display/api",
          "names": [
            "*"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/types/index.ts",
      "symbols": [],
      "imports": [],
      "reExports": [
        {
          "from": "./verbosity.level.js",
          "name": "VerbosityLevel",
          "typeOnly": false
        }
      ]
    },
    {
      "path": "src/types/verbosity.level.ts",
      "symbols": [
        {
          "name": "VerbosityLevel",
          "kind": "enum",
          "line": 8,
          "exported": true,
          "signature": "export enum VerbosityLevel { ERRORS = 0, WARNINGS = 1, INFOS = 5, }"
        }
      ],
      "imports": [],
      "reExports": []
    }
  ]
}
```
