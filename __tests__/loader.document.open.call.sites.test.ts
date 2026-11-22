import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseSync, Visitor } from 'rolldown/utils';
import { expect, test } from 'vitest';

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

function callersOf(callee: string, sourceText: string): string[] {
    const parsed = parseSync('module.ts', sourceText);
    expect(parsed.errors).toEqual([]);
    const functions: string[] = [];
    const callers: string[] = [];
    new Visitor({
        FunctionDeclaration(node) {
            if (node.id) functions.push(node.id.name);
        },
        'FunctionDeclaration:exit'(node) {
            if (node.id) functions.pop();
        },
        MethodDefinition(node) {
            functions.push(sourceText.slice(node.key.start, node.key.end));
        },
        'MethodDefinition:exit'() {
            functions.pop();
        },
        CallExpression(node) {
            if (node.callee.type === 'Identifier' && node.callee.name === callee) {
                callers.push(functions.at(-1) ?? '<module>');
            }
        },
    }).visit(parsed.program);
    return callers;
}

function callSitesInSource(callee: string): CallSite[] {
    return readdirSync(SOURCE_DIRECTORY)
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
        .flatMap((file) => callersOf(callee, readFileSync(join(SOURCE_DIRECTORY, file), 'utf8')).map((caller) => ({ file, caller })));
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
    const sneaky = [
        '// getPdfDocument(bytes, options) in a comment',
        "const text = 'getPdfDocument(bytes, options)';",
        'export async function openEarly() { return getPdfDocument(bytes, options); }',
        'export const openLater = async () => getPdfDocument(bytes, options);',
    ].join('\n');

    expect(callersOf('getPdfDocument', sneaky)).toEqual(['openEarly', '<module>']);
});
