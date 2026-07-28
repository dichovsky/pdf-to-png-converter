# CODEMAP

Machine-readable symbol index for coding agents. Regenerate with `npm run codemap`.
Verified by `npm run codemap:check` (CI). Do not hand-edit.

```json
{
  "schema": "codemap.v2",
  "repo": {
    "name": "pdf-to-png-converter",
    "version": "4.2.0"
  },
  "sourceHash": "892aa3dfd2946dabcd27adf286e1a268a35f70bc8b9ed32abe6e274075137bd5",
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
      "line": 31,
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
          "signature": "export const HELP_TEXT = `Usage: pdf-to-png-converter <pdf-file-path> [options]\n\nOptions:\n  --output-folder <dir>             Folder path where PNG files will be written (required unless --return-meta…"
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
          "line": 57,
          "exported": false,
          "signature": "type ParsedValues = { 'output-folder'?: string; 'viewport-scale'?: string; 'use-system-fonts'?: boolean; 'disable-font-face'?: string; 'enable-xfa'?: string; 'pdf-file-password'?: string; 'pages-to-pr…"
        },
        {
          "name": "CliParseResult",
          "kind": "type",
          "line": 76,
          "exported": false,
          "signature": "type CliParseResult = { values: ParsedValues; positionals: string[] };"
        },
        {
          "name": "parseBoolean",
          "kind": "function",
          "line": 87,
          "exported": true,
          "signature": "export function parseBoolean(val: string | undefined): boolean | undefined"
        },
        {
          "name": "parseNumberList",
          "kind": "function",
          "line": 101,
          "exported": true,
          "signature": "export function parseNumberList(val: string | undefined): number[] | undefined"
        },
        {
          "name": "parseNumericOption",
          "kind": "function",
          "line": 112,
          "exported": false,
          "signature": "function parseNumericOption(value: string | undefined, errorMessage: string): number | undefined"
        },
        {
          "name": "parseIntegerOption",
          "kind": "function",
          "line": 128,
          "exported": false,
          "signature": "function parseIntegerOption(value: string | undefined, errorMessage: string): number | undefined"
        },
        {
          "name": "safeParseArgs",
          "kind": "function",
          "line": 144,
          "exported": false,
          "signature": "function safeParseArgs(): CliParseResult | null"
        },
        {
          "name": "buildPdfToPngOptions",
          "kind": "function",
          "line": 165,
          "exported": true,
          "signature": "export function buildPdfToPngOptions( values: ParsedValues, positionals: string[], ): { pdfFilePath: string; options: NormalizedPdfToPngOptions }"
        },
        {
          "name": "executeConversion",
          "kind": "function",
          "line": 205,
          "exported": true,
          "signature": "export async function executeConversion( pdfFilePath: string, options: NormalizedPdfToPngOptions, logInfo: (...msgs: unknown[]) => void, writeOutput: (...msgs: unknown[]) => void = console.log, ): Pro…"
        },
        {
          "name": "createLogger",
          "kind": "function",
          "line": 226,
          "exported": false,
          "signature": "function createLogger(silent: boolean | undefined): (...msgs: unknown[]) => void"
        },
        {
          "name": "handleRunError",
          "kind": "function",
          "line": 232,
          "exported": false,
          "signature": "function handleRunError(err: unknown): void"
        },
        {
          "name": "getVersion",
          "kind": "function",
          "line": 251,
          "exported": true,
          "signature": "export function getVersion(): string"
        },
        {
          "name": "run",
          "kind": "function",
          "line": 271,
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
          "line": 16,
          "exported": true,
          "signature": "export const MAX_CANVAS_PIXELS = 100_000_000"
        },
        {
          "name": "MAX_INPUT_BYTES",
          "kind": "variable",
          "line": 25,
          "exported": true,
          "signature": "export const MAX_INPUT_BYTES = 256 * 1024 * 1024"
        },
        {
          "name": "MAX_CONCURRENCY_LIMIT",
          "kind": "variable",
          "line": 33,
          "exported": true,
          "signature": "export const MAX_CONCURRENCY_LIMIT = 16"
        },
        {
          "name": "SEQUENTIAL_PIPELINE_WINDOW",
          "kind": "variable",
          "line": 46,
          "exported": true,
          "signature": "export const SEQUENTIAL_PIPELINE_WINDOW = 3"
        },
        {
          "name": "PDF_TO_PNG_OPTIONS_DEFAULTS",
          "kind": "variable",
          "line": 52,
          "exported": true,
          "signature": "export const PDF_TO_PNG_OPTIONS_DEFAULTS = { viewportScale: 1, disableFontFace: true, useSystemFonts: false, enableXfa: true, outputFileMask: 'buffer', pdfFilePassword: undefined, concurrencyLimit: 4,…"
        },
        {
          "name": "CMAP_RELATIVE_URL",
          "kind": "variable",
          "line": 71,
          "exported": true,
          "signature": "export const CMAP_RELATIVE_URL = './node_modules/pdfjs-dist/cmaps/'"
        },
        {
          "name": "STANDARD_FONTS_RELATIVE_URL",
          "kind": "variable",
          "line": 72,
          "exported": true,
          "signature": "export const STANDARD_FONTS_RELATIVE_URL = './node_modules/pdfjs-dist/standard_fonts/'"
        },
        {
          "name": "DOCUMENT_INIT_PARAMS_DEFAULTS",
          "kind": "variable",
          "line": 84,
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
          "line": 5,
          "exported": true,
          "signature": "export class FilesystemSink implements OutputSink {",
          "members": [
            {
              "name": "constructor",
              "kind": "constructor",
              "line": 6
            },
            {
              "name": "write",
              "kind": "method",
              "line": 8
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
            "OutputFolderHandle"
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
      "path": "src/flatFilename.ts",
      "symbols": [
        {
          "name": "PATH_SEPARATOR_PATTERN",
          "kind": "variable",
          "line": 10,
          "exported": false,
          "signature": "const PATH_SEPARATOR_PATTERN = sep === '\\\\' ? /[\\\\/]/ : /\\"
        },
        {
          "name": "SEPARATOR_DESCRIPTION",
          "kind": "variable",
          "line": 13,
          "exported": true,
          "signature": "export const SEPARATOR_DESCRIPTION = sep === '\\\\' ? '\"/\" or \"\\\\\"' : '\"/\"'"
        },
        {
          "name": "containsPathSeparator",
          "kind": "function",
          "line": 16,
          "exported": true,
          "signature": "export function containsPathSeparator(name: string): boolean"
        }
      ],
      "imports": [
        {
          "from": "node:path",
          "names": [
            "sep"
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
          "line": 13,
          "exported": true,
          "signature": "export interface MetadataPngPageOutput extends BasePngPageOutput { kind: 'metadata'; content: undefined; path: ''; }"
        },
        {
          "name": "InMemoryPngPageOutput",
          "kind": "interface",
          "line": 19,
          "exported": true,
          "signature": "export interface InMemoryPngPageOutput extends BasePngPageOutput { kind: 'content'; content: Buffer | undefined; path: ''; }"
        },
        {
          "name": "FilePngPageOutput",
          "kind": "interface",
          "line": 25,
          "exported": true,
          "signature": "export interface FilePngPageOutput extends BasePngPageOutput { kind: 'file'; content: Buffer | undefined; path: string; }"
        },
        {
          "name": "PngPageOutput",
          "kind": "type",
          "line": 31,
          "exported": true,
          "signature": "export type PngPageOutput = MetadataPngPageOutput | InMemoryPngPageOutput | FilePngPageOutput;"
        }
      ],
      "imports": [],
      "reExports": []
    },
    {
      "path": "src/interfaces/worker.protocol.ts",
      "symbols": [
        {
          "name": "WorkerDocumentOptions",
          "kind": "interface",
          "line": 18,
          "exported": true,
          "signature": "export interface WorkerDocumentOptions { viewportScale?: number; disableFontFace?: boolean; useSystemFonts?: boolean; enableXfa?: boolean; pdfFilePassword?: string; verbosityLevel?: number; }"
        },
        {
          "name": "WorkerInitData",
          "kind": "interface",
          "line": 28,
          "exported": true,
          "signature": "export interface WorkerInitData { pdfBuffer: Uint8Array; documentOptions: WorkerDocumentOptions; materializeContent: boolean; }"
        },
        {
          "name": "RenderPageRequest",
          "kind": "interface",
          "line": 36,
          "exported": true,
          "signature": "export interface RenderPageRequest { type: 'render'; index: number; pageNumber: number; pageName: string; }"
        },
        {
          "name": "RenderedPageMessage",
          "kind": "interface",
          "line": 45,
          "exported": true,
          "signature": "export interface RenderedPageMessage { type: 'result'; index: number; pageNumber: number; name: string; width: number; height: number; rotation: PageRotation; content: Uint8Array | undefined; }"
        },
        {
          "name": "RenderErrorMessage",
          "kind": "interface",
          "line": 62,
          "exported": true,
          "signature": "export interface RenderErrorMessage { type: 'render-error'; index: number; error: unknown; }"
        },
        {
          "name": "FatalErrorMessage",
          "kind": "interface",
          "line": 69,
          "exported": true,
          "signature": "export interface FatalErrorMessage { type: 'fatal'; error: unknown; }"
        },
        {
          "name": "WorkerResponse",
          "kind": "type",
          "line": 74,
          "exported": true,
          "signature": "export type WorkerResponse = RenderedPageMessage | RenderErrorMessage | FatalErrorMessage;"
        }
      ],
      "imports": [
        {
          "from": "./index.js",
          "names": [
            "PageRotation"
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
          "line": 26,
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
          "line": 23,
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
      "path": "src/outputWriter.ts",
      "symbols": [
        {
          "name": "isEscapingRelativePath",
          "kind": "function",
          "line": 5,
          "exported": false,
          "signature": "function isEscapingRelativePath(rel: string): boolean"
        },
        {
          "name": "OutputFolderHandle",
          "kind": "interface",
          "line": 15,
          "exported": true,
          "signature": "export interface OutputFolderHandle { readonly resolvedOutputFolder: string; readonly realOutputFolder: string; }"
        },
        {
          "name": "resolveOutputFolder",
          "kind": "function",
          "line": 26,
          "exported": true,
          "signature": "export function resolveOutputFolder(outputFolder: string): string"
        },
        {
          "name": "prepareOutputFolder",
          "kind": "function",
          "line": 40,
          "exported": true,
          "signature": "export async function prepareOutputFolder(resolvedOutputFolder: string): Promise<OutputFolderHandle>"
        },
        {
          "name": "savePNGfile",
          "kind": "function",
          "line": 64,
          "exported": true,
          "signature": "export async function savePNGfile(name: string, content: Buffer, folder: OutputFolderHandle): Promise<string>"
        }
      ],
      "imports": [
        {
          "from": "./flatFilename.js",
          "names": [
            "SEPARATOR_DESCRIPTION",
            "containsPathSeparator"
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
            "isAbsolute",
            "join",
            "relative",
            "resolve",
            "sep"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/pageMode.ts",
      "symbols": [
        {
          "name": "PageMode",
          "kind": "type",
          "line": 16,
          "exported": true,
          "signature": "export type PageMode = | { readonly kind: 'metadata' } | { readonly kind: 'content'; readonly returnContent: boolean } | { readonly kind: 'file'; readonly sink: OutputSink; readonly returnContent: boo…"
        },
        {
          "name": "optionsToPageMode",
          "kind": "function",
          "line": 27,
          "exported": true,
          "signature": "export function optionsToPageMode(opts: NormalizedPdfToPngOptions, sink: OutputSink | undefined): PageMode"
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
          "from": "./normalizePdfToPngOptions.js",
          "names": [
            "NormalizedPdfToPngOptions"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/pageOrchestrator.ts",
      "symbols": [
        {
          "name": "RenderedPageMode",
          "kind": "type",
          "line": 8,
          "exported": true,
          "signature": "export type RenderedPageMode = Exclude<PageMode, { kind: 'metadata' }>;"
        },
        {
          "name": "assertFlatFilename",
          "kind": "function",
          "line": 10,
          "exported": false,
          "signature": "function assertFlatFilename(name: string, pageNumber: number): void"
        },
        {
          "name": "resolvePageName",
          "kind": "function",
          "line": 18,
          "exported": true,
          "signature": "export function resolvePageName( pageNumber: number, defaultMask: string, outputFileMaskFunc: ((page: number) => string) | undefined, ): string"
        },
        {
          "name": "finalizePageOutput",
          "kind": "function",
          "line": 51,
          "exported": true,
          "signature": "export async function finalizePageOutput(pageOutput: InMemoryPngPageOutput, mode: RenderedPageMode): Promise<PngPageOutput>"
        },
        {
          "name": "shouldMaterializeContent",
          "kind": "function",
          "line": 73,
          "exported": true,
          "signature": "export function shouldMaterializeContent(mode: RenderedPageMode): boolean"
        },
        {
          "name": "processAndSavePage",
          "kind": "function",
          "line": 77,
          "exported": true,
          "signature": "export async function processAndSavePage( pdfDocument: PDFDocumentProxy, pageName: string, pageNumber: number, pageViewportScale: number, mode: PageMode, ): Promise<PngPageOutput>"
        }
      ],
      "imports": [
        {
          "from": "./flatFilename.js",
          "names": [
            "SEPARATOR_DESCRIPTION",
            "containsPathSeparator"
          ]
        },
        {
          "from": "./interfaces/index.js",
          "names": [
            "FilePngPageOutput",
            "InMemoryPngPageOutput",
            "PngPageOutput"
          ]
        },
        {
          "from": "./pageMode.js",
          "names": [
            "PageMode"
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
          "from": "pdfjs-dist",
          "names": [
            "PDFDocumentProxy"
          ]
        }
      ],
      "reExports": []
    },
    {
      "path": "src/pageRenderWorker.ts",
      "symbols": [
        {
          "name": "port",
          "kind": "variable",
          "line": 23,
          "exported": false,
          "signature": "const port = parentPort"
        },
        {
          "name": "init",
          "kind": "variable",
          "line": 24,
          "exported": false,
          "signature": "const init = workerData as WorkerInitData"
        },
        {
          "name": "normalizedOptions",
          "kind": "variable",
          "line": 28,
          "exported": false,
          "signature": "const normalizedOptions = normalizePdfToPngOptions(init.documentOptions)"
        },
        {
          "name": "documentPromise",
          "kind": "variable",
          "line": 30,
          "exported": false,
          "signature": "let documentPromise: Promise<PDFDocumentProxy> | undefined"
        },
        {
          "name": "postErrorResponse",
          "kind": "function",
          "line": 37,
          "exported": false,
          "signature": "function postErrorResponse(build: (error: unknown) => WorkerResponse, error: unknown): void"
        },
        {
          "name": "handleRender",
          "kind": "function",
          "line": 45,
          "exported": false,
          "signature": "async function handleRender(request: RenderPageRequest): Promise<void>"
        }
      ],
      "imports": [
        {
          "from": "./interfaces/worker.protocol.js",
          "names": [
            "RenderPageRequest",
            "WorkerInitData",
            "WorkerResponse"
          ]
        },
        {
          "from": "./normalizePdfToPngOptions.js",
          "names": [
            "normalizePdfToPngOptions"
          ]
        },
        {
          "from": "./pageRenderer.js",
          "names": [
            "renderPdfPage"
          ]
        },
        {
          "from": "./pdfjsLoader.js",
          "names": [
            "getPdfDocument"
          ]
        },
        {
          "from": "node:worker_threads",
          "names": [
            "parentPort",
            "workerData"
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
          "name": "CanvasFactory",
          "kind": "interface",
          "line": 15,
          "exported": false,
          "signature": "interface CanvasFactory { create(width: number, height: number): CanvasAndContext; destroy(canvasAndContext: CanvasAndContext): void; }"
        },
        {
          "name": "isCanvasFactory",
          "kind": "function",
          "line": 26,
          "exported": false,
          "signature": "function isCanvasFactory(factory: unknown): factory is CanvasFactory"
        },
        {
          "name": "toPixelDimension",
          "kind": "function",
          "line": 47,
          "exported": true,
          "signature": "export function toPixelDimension(viewportLength: number): number"
        },
        {
          "name": "nonRenderableDimensionsError",
          "kind": "function",
          "line": 61,
          "exported": true,
          "signature": "export function nonRenderableDimensionsError(width: number, height: number): Error"
        },
        {
          "name": "canvasPixelLimitError",
          "kind": "function",
          "line": 80,
          "exported": true,
          "signature": "export function canvasPixelLimitError(canvasWidth: number, canvasHeight: number): Error"
        },
        {
          "name": "normalizeRotation",
          "kind": "function",
          "line": 90,
          "exported": true,
          "signature": "export function normalizeRotation(raw: number): PageRotation"
        },
        {
          "name": "getPageMetadata",
          "kind": "function",
          "line": 106,
          "exported": true,
          "signature": "export async function getPageMetadata( pdf: PDFDocumentProxy, pageName: string, pageNumber: number, pageViewportScale: number, ): Promise<MetadataPngPageOutput>"
        },
        {
          "name": "renderPdfPage",
          "kind": "function",
          "line": 141,
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
            "CanvasAndContext",
            "InMemoryPngPageOutput",
            "MetadataPngPageOutput",
            "PageRotation"
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
          "name": "isByteArrayLike",
          "kind": "function",
          "line": 10,
          "exported": false,
          "signature": "function isByteArrayLike(value: unknown): value is ArrayLike<number>"
        },
        {
          "name": "getPdfFileBuffer",
          "kind": "function",
          "line": 20,
          "exported": true,
          "signature": "export async function getPdfFileBuffer(pdfFile: string | ArrayBufferLike | Uint8Array, maxInputBytes: number): Promise<Uint8Array>"
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
          "line": 17,
          "exported": false,
          "signature": "async function processPagesWithSlidingWindow<T>( pageNumbers: number[], concurrencyLimit: number, processPage: (pageNumber: number, index: number) => Promise<T>, ): Promise<T[]>"
        },
        {
          "name": "findDuplicateOutputName",
          "kind": "function",
          "line": 71,
          "exported": false,
          "signature": "function findDuplicateOutputName(names: string[], pageNumbers: number[]): { name: string; pages: number[] } | undefined"
        },
        {
          "name": "pdfToPngCore",
          "kind": "function",
          "line": 99,
          "exported": true,
          "signature": "export async function pdfToPngCore( pdfFile: string | ArrayBufferLike | Uint8Array, normalizedProps: NormalizedPdfToPngOptions, ): Promise<PngPageOutput[]>"
        }
      ],
      "imports": [
        {
          "from": "./const.js",
          "names": [
            "PDF_TO_PNG_OPTIONS_DEFAULTS",
            "SEQUENTIAL_PIPELINE_WINDOW"
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
            "InMemoryPngPageOutput",
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
          "from": "./interfaces/worker.protocol.js",
          "names": [
            "WorkerDocumentOptions"
          ]
        },
        {
          "from": "./normalizePdfToPngOptions.js",
          "names": [
            "NormalizedPdfToPngOptions"
          ]
        },
        {
          "from": "./outputWriter.js",
          "names": [
            "prepareOutputFolder",
            "resolveOutputFolder"
          ]
        },
        {
          "from": "./pageMode.js",
          "names": [
            "optionsToPageMode"
          ]
        },
        {
          "from": "./pageOrchestrator.js",
          "names": [
            "finalizePageOutput",
            "processAndSavePage",
            "resolvePageName",
            "shouldMaterializeContent"
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
          "from": "./workerPool.js",
          "names": [
            "WorkerPageTask"
          ]
        },
        {
          "from": "./workerPool.js",
          "names": [
            "renderPagesInWorkerPool"
          ]
        },
        {
          "from": "node:path",
          "names": [
            "parse"
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
          "signature": "export async function getPdfDocument(pdfFileBuffer: Uint8Array, opts: NormalizedPdfToPngOptions): Promise<PDFDocumentProxy>"
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
    },
    {
      "path": "src/workerPool.ts",
      "symbols": [
        {
          "name": "WorkerPageTask",
          "kind": "interface",
          "line": 8,
          "exported": true,
          "signature": "export interface WorkerPageTask { index: number; pageNumber: number; pageName: string; }"
        },
        {
          "name": "WorkerRenderedPage",
          "kind": "interface",
          "line": 15,
          "exported": true,
          "signature": "export interface WorkerRenderedPage { pageNumber: number; name: string; width: number; height: number; rotation: PageRotation; content: Buffer | undefined; }"
        },
        {
          "name": "resolveWorkerEntryPath",
          "kind": "function",
          "line": 30,
          "exported": false,
          "signature": "function resolveWorkerEntryPath(): string"
        },
        {
          "name": "renderPagesInWorkerPool",
          "kind": "function",
          "line": 57,
          "exported": true,
          "signature": "export async function renderPagesInWorkerPool( pdfBuffer: Uint8Array, documentOptions: WorkerDocumentOptions, materializeContent: boolean, tasks: WorkerPageTask[], poolSize: number, onPageRendered: (i…"
        }
      ],
      "imports": [
        {
          "from": "./interfaces/index.js",
          "names": [
            "PageRotation"
          ]
        },
        {
          "from": "./interfaces/worker.protocol.js",
          "names": [
            "RenderPageRequest",
            "WorkerDocumentOptions",
            "WorkerInitData",
            "WorkerResponse"
          ]
        },
        {
          "from": "node:fs",
          "names": [
            "existsSync"
          ]
        },
        {
          "from": "node:path",
          "names": [
            "join"
          ]
        },
        {
          "from": "node:worker_threads",
          "names": [
            "Worker"
          ]
        }
      ],
      "reExports": []
    }
  ]
}
```
