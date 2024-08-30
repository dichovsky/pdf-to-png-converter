import { normalize, resolve } from 'node:path';

/**
 * Normalizes a given path by ensuring it ends with the appropriate path separator.
 * 
 * @param path - The path to be normalized.
 * @returns The normalized path.
 * @throws Error if the path is empty.
 */
export function normalizePath(path: string): string {
    if (path === '') {
        throw new Error('Path cannot be empty');
    }
    const resolvedPath: string = (normalize(resolve( path)));

    if (process.platform === 'win32') {
        if (resolvedPath.endsWith('\\')) {
            return resolvedPath;
        }
        return `${resolvedPath}\\`;
    }

    if (resolvedPath.endsWith('/')) {
        return resolvedPath;
    }

    return `${resolvedPath}/`;
}
