import Module from 'node:module';
import { vi } from 'vitest';

type ResolveFilename = (request: string, parent: { filename?: string | null } | null | undefined, ...rest: unknown[]) => string;

const nodeModule = Module as unknown as { _resolveFilename: ResolveFilename };
// Captured once, before any spy, so a second interception in the same test cannot call itself.
const realResolveFilename = nodeModule._resolveFilename;

/**
 * Intercepts the loader's `require.resolve('pdfjs-dist/package.json')`. Node routes that call through
 * `Module._resolveFilename` with the loader as the parent module, so only that request from `pdfjsLoader.ts` is
 * answered by `lookup` (which receives the loader's filename and returns a package.json path or throws). Every other
 * resolution goes to the real function. `vi.restoreAllMocks()` removes the interception.
 */
export function interceptPdfjsPackageLookup(lookup: (searchedFrom: string) => string): void {
    vi.spyOn(nodeModule, '_resolveFilename').mockImplementation(function (this: unknown, request, parent, ...rest) {
        const searchedFrom = parent?.filename ?? '';
        if (request === 'pdfjs-dist/package.json' && /pdfjsLoader\.ts$/.test(searchedFrom)) {
            return lookup(searchedFrom);
        }
        return realResolveFilename.call(this, request, parent, ...rest);
    });
}
