import { resolve, join } from "path/posix";

export function normalizePath(path: string): string {
    const resolvedPath: string = resolve(join(path));
    if (resolvedPath.endsWith('/')) {
        return resolvedPath;
    }
    return `${resolvedPath}/`;
}
