import { normalize, resolve } from 'node:path';

/**
 * Resolves a path to an absolute path and ensures it ends with a trailing path separator (`/`).
 *
 * Internally calls `resolve()` to convert the input to an absolute path (relative to `process.cwd()`),
 * then `normalize()` to collapse any redundant separators or `.` / `..` segments.
 * A trailing `/` is appended if not already present, which is required for pdfjs URL-style
 * paths such as `cMapUrl` and `standardFontDataUrl`.
 *
 * @param path - The path to normalize. Must be a non-empty string.
 * @returns The resolved, normalized path with a guaranteed trailing `/`.
 * @throws {Error} If `path` is an empty string.
 *
 * @example
 * normalizePath('./node_modules/pdfjs-dist/cmaps/');
 * // => '/absolute/path/to/project/node_modules/pdfjs-dist/cmaps/'
 */
export function normalizePath(path: string): string {
    if (path === '') {
        throw new Error('Path cannot be empty');
    }
    const resolvedPath: string = normalize(resolve(path));

    if (resolvedPath.endsWith('/')) {
        return resolvedPath;
    }

    return `${resolvedPath}/`;
}
