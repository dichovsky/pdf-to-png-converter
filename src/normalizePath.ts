import { normalize, resolve, sep } from 'node:path';

/**
 * Resolves a path to an absolute pdf.js factory URL (`cMapUrl` / `standardFontDataUrl`).
 *
 * Internally calls `resolve()` to convert the input to an absolute path (relative to `process.cwd()`),
 * then `normalize()` to collapse any redundant separators or `.` / `..` segments, then rewrites the
 * OS separator to a forward slash and guarantees a trailing `/`.
 *
 * The trailing character MUST be a forward slash `/` on every platform: pdf.js validates these values
 * with `getFactoryUrlProp`, which throws `Invalid factory url ... must include trailing slash.` for any
 * other terminator. The intermediate separators are forward-slashed too, since pdf.js reads the asset
 * via a bare `fs.readFile(\`${baseUrl}${filename}\`)` and Node accepts `/` on Windows. Do NOT change the
 * terminator back to `path.sep`: on Windows that yields a `\`-terminated value and breaks every
 * conversion (see issue #173). This function's only consumer is `propsToPdfDocInitParams`.
 *
 * @param path - The path to normalize. Must be a non-empty string.
 * @returns The resolved, forward-slashed absolute path with a guaranteed trailing `/`.
 * @throws {Error} If `path` is an empty string.
 *
 * @example
 * normalizePath('./node_modules/pdfjs-dist/cmaps/');
 * // POSIX:   '/absolute/path/to/project/node_modules/pdfjs-dist/cmaps/'
 * // Windows: 'C:/absolute/path/to/project/node_modules/pdfjs-dist/cmaps/'
 */
export function normalizePath(path: string): string {
    if (path === '') {
        throw new Error('Path cannot be empty');
    }
    const resolvedPath: string = normalize(resolve(path)).split(sep).join('/');

    return resolvedPath.endsWith('/') ? resolvedPath : `${resolvedPath}/`;
}
