import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { API } from 'typescript/unstable/sync';
import { isCallExpression, isFunctionDeclaration, isIdentifier, isMethodDeclaration, type Node } from 'typescript/unstable/ast';
import { afterAll, expect, test } from 'vitest';

/**
 * Every main-thread document must open after the one-time wasm warm-up (CLAUDE.md invariant 11, issue #288): without it a
 * CCITT, JBIG2 or JPEG 2000 conversion can wait forever. Today pdfToPng() awaits warmUpWasmDecoders() right before its
 * getPdfDocument() call, and that ordering is pinned by pdfjs.loader.wasm.warmup.test.ts. This test closes the other gap:
 * a NEW module that opens a document would skip the warm-up unnoticed.
 *
 * Allowed callers of getPdfDocument(): pdfToPng.ts (awaits the warm-up first), pageRenderWorker.ts (one document per
 * worker thread, exempt) and the warm-up itself in pdfjsLoader.ts. If this fails, either await warmUpWasmDecoders()
 * before the new call or add the caller here with the reason it is exempt. getDocument() may only be called from
 * getPdfDocument(), the one funnel.
 */

const SOURCE_DIRECTORY = resolve(__dirname, '..', 'src');

interface CallSite {
    file: string;
    /** The nearest named function or method around the call, else `<module>`. */
    caller: string;
}

const compiler = new API();
afterAll(() => compiler.close());
const config = resolve(SOURCE_DIRECTORY, '..', 'tsconfig.json');
const project = compiler.updateSnapshot({ openProjects: [config] }).getProject(config);

function callersOf(callee: string, file: string): string[] {
    const source = project?.program.getSourceFile(file);
    if (!source) throw new Error(`TypeScript did not load ${file}`);
    const callers: string[] = [];

    function visit(node: Node, enclosing: string): void {
        const caller = (isFunctionDeclaration(node) || isMethodDeclaration(node)) && node.name ? node.name.getText() : enclosing;
        if (isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === callee) {
            callers.push(caller);
        }
        node.forEachChild((child) => visit(child, caller));
    }
    visit(source, '<module>');
    return callers;
}

function callSitesInSource(callee: string): CallSite[] {
    return readdirSync(SOURCE_DIRECTORY)
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
        .flatMap((file) => callersOf(callee, join(SOURCE_DIRECTORY, file)).map((caller) => ({ file, caller })));
}

test('only pdfToPng.ts, pageRenderWorker.ts and the warm-up itself call getPdfDocument', () => {
    const sites = callSitesInSource('getPdfDocument');

    expect([...new Set(sites.map((site) => site.file))].sort()).toEqual(['pageRenderWorker.ts', 'pdfToPng.ts', 'pdfjsLoader.ts']);
    expect(sites.filter((site) => site.file === 'pdfjsLoader.ts').map((site) => site.caller)).toEqual(['decodeWarmUpImages']);
});

test('getDocument is called only from getPdfDocument', () => {
    expect(callSitesInSource('getDocument')).toEqual([{ file: 'pdfjsLoader.ts', caller: 'getPdfDocument' }]);
});

test('the scanner reports a call from any function and ignores comments and strings', () => {
    // Both probe() in this comment and the string below must be ignored by the scanner.
    const probe = () => 'probe()';
    function openEarly(): string {
        return probe();
    }
    const openLater = () => probe();
    expect(openEarly()).toBe(openLater());
    expect(callersOf('probe', __filename)).toEqual(['openEarly', '<module>']);
});
