import { normalize, resolve, sep } from 'node:path';

/**
 * Resolves a path to an absolute path and ensures it ends with a trailing path separator.
 *
 * Internally calls `resolve()` to convert the input to an absolute path (relative to `process.cwd()`),
 * then `normalize()` to collapse any redundant separators or `.` / `..` segments.
 * A trailing `path.sep` is appended if not already present. On POSIX systems this is `/`;
 * on Windows it is `\`. Both are required for pdfjs URL-style paths (`cMapUrl`,
 * `standardFontDataUrl`) and for general filesystem path correctness on each platform.
 *
 * @param path - The path to normalize. Must be a non-empty string.
 * @returns The resolved, normalized path with a guaranteed trailing platform separator.
 * @throws {Error} If `path` is an empty string.
 *
 * @example
 * normalizePath('./node_modules/pdfjs-dist/cmaps/');
 * // POSIX:   '/absolute/path/to/project/node_modules/pdfjs-dist/cmaps/'
 * // Windows: 'C:\\absolute\\path\\to\\project\\node_modules\\pdfjs-dist\\cmaps\\'
 */
export function normalizePath(path: string): string {
    if (path === '') {
        throw new Error('Path cannot be empty');
    }
    const resolvedPath: string = normalize(resolve(path));

    if (resolvedPath.endsWith('/') || resolvedPath.endsWith(sep)) {
        return resolvedPath;
    }

    return `${resolvedPath}${sep}`;
}
