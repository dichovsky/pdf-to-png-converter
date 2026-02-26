/**
 * Verbosity levels for the pdfjs-dist logger, passed via `PdfToPngOptions.verbosityLevel`.
 *
 * - `ERRORS` (0)   — only errors are logged (default, recommended for production)
 * - `WARNINGS` (1) — errors and warnings are logged
 * - `INFOS` (5)    — all messages including informational output are logged
 */
export enum VerbosityLevel {
    ERRORS = 0,
    WARNINGS = 1,
    INFOS = 5,
}
