import { realpathSync } from 'node:fs';

/** Early Node 24 releases predate import.meta.main. */
export function isMainModule(meta: { main?: boolean; filename: string }): boolean {
    if (meta.main !== undefined) return meta.main;
    const entry = process.argv[1];
    if (!entry) return false;
    try {
        return realpathSync(entry) === meta.filename;
    } catch {
        return false;
    }
}
