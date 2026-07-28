import { sep } from 'node:path';

// Reject only characters the host OS treats as path separators. On Windows both "\" and "/"
// are separators; on POSIX only "/" is — "\" is a valid filename character there, so PDFs
// such as `foo\bar.pdf` must still convert successfully when the library derives the default
// page-name mask from `path.parse(pdfFile).name`. See SEC-001 in CHANGELOG / BACKLOG for the
// threat model: rejecting separators is what closes the TOCTOU window on intermediate
// directory components, so both the name-resolution seam (pageOrchestrator) and the write
// seam (outputWriter) must apply the exact same predicate.
const PATH_SEPARATOR_PATTERN = sep === '\\' ? /[\\/]/ : /\//;

/** The separators rejected on this host, rendered for inclusion in error messages. */
export const SEPARATOR_DESCRIPTION = sep === '\\' ? '"/" or "\\"' : '"/"';

/** Whether `name` contains a character the host OS treats as a path separator. */
export function containsPathSeparator(name: string): boolean {
    return PATH_SEPARATOR_PATTERN.test(name);
}
