import { resolve, join, normalize } from "path/posix";

export function normalizePath(path: string): string {
    const resolvedPath: string = normalize(resolve(join(path)));
    console.log(process.platform)
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
