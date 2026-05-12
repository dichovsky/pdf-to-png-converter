import { createHash } from 'node:crypto';
import { promises as fsPromises, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

interface CodemapConfig {
    sourceDirs: string[];
    entrypoints: string[];
    exclude: string[];
    maxSignatureLength: number;
}

interface SymbolMember {
    name: string;
    kind: 'constructor' | 'method' | 'property' | 'getter' | 'setter';
    line: number;
}

interface FileSymbol {
    name: string;
    kind: string;
    line: number;
    exported: boolean;
    signature: string;
    members?: SymbolMember[];
}

interface FileImport {
    from: string;
    names: string[];
}

interface FileReExport {
    from: string;
    name: string;
    typeOnly: boolean;
}

interface FileEntry {
    path: string;
    symbols: FileSymbol[];
    imports: FileImport[];
    reExports: FileReExport[];
}

interface PublicApiEntry {
    name: string;
    kind: string;
    file: string;
    line: number;
    signature: string;
    jsdoc: string;
    typeOnly: boolean;
}

interface Codemap {
    schema: 'codemap.v2';
    repo: { name: string; version: string };
    sourceHash: string;
    entrypoints: string[];
    publicApi: PublicApiEntry[];
    files: FileEntry[];
}

type NamedDecl =
    | ts.FunctionDeclaration
    | ts.ClassDeclaration
    | ts.InterfaceDeclaration
    | ts.TypeAliasDeclaration
    | ts.EnumDeclaration;

const ROOT = process.cwd();
const CONFIG_PATH = resolve(ROOT, 'codemap.config.json');
const OUTPUT_PATH = resolve(ROOT, 'CODEMAP.md');
const PACKAGE_JSON_PATH = resolve(ROOT, 'package.json');
const HEADER = `# CODEMAP

Machine-readable symbol index for coding agents. Regenerate with \`npm run codemap\`.
Verified by \`npm run codemap:check\` (CI). Do not hand-edit.
`;

function loadConfig(): CodemapConfig {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<CodemapConfig>;
    return {
        sourceDirs: raw.sourceDirs ?? ['src'],
        entrypoints: raw.entrypoints ?? ['src/index.ts'],
        exclude: raw.exclude ?? [],
        maxSignatureLength: raw.maxSignatureLength ?? 200,
    };
}

function loadRepoMeta(): { name: string; version: string } {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as { name?: string; version?: string };
    return { name: pkg.name ?? '', version: pkg.version ?? '' };
}

function toPosix(p: string): string {
    return p.split('\\').join('/');
}

function cmp(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function globToRegex(pattern: string): RegExp {
    let re = '^';
    let i = 0;
    while (i < pattern.length) {
        const c = pattern[i];
        if (c === '*' && pattern[i + 1] === '*' && pattern[i + 2] === '/') {
            re += '(?:.*/)?';
            i += 3;
        } else if (c === '*' && pattern[i + 1] === '*') {
            re += '.*';
            i += 2;
        } else if (c === '*') {
            re += '[^/]*';
            i += 1;
        } else if (c === '?') {
            re += '[^/]';
            i += 1;
        } else {
            re += '.+^$()|{}[]\\'.includes(c) ? `\\${c}` : c;
            i += 1;
        }
    }
    return new RegExp(`${re}$`);
}

async function walkDir(dir: string): Promise<string[]> {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    const out = await Promise.all(
        entries.map(async (e) => {
            const full = resolve(dir, e.name);
            if (e.isDirectory()) return await walkDir(full);
            return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
        }),
    );
    return out.flat();
}

async function discoverSources(config: CodemapConfig): Promise<string[]> {
    const compiled = config.exclude.map(globToRegex);
    const all = (
        await Promise.all(
            config.sourceDirs.map(async (dir) => {
                try {
                    return await walkDir(resolve(ROOT, dir));
                } catch {
                    return [];
                }
            }),
        )
    ).flat();
    return all
        .filter((abs) => {
            const rel = toPosix(relative(ROOT, abs));
            if (compiled.some((rx) => rx.test(rel))) return false;
            return !rel.endsWith('.d.ts') || rel.startsWith('src/types/');
        })
        .sort(cmp);
}

function computeSourceHash(files: { path: string; content: string }[]): string {
    const hash = createHash('sha256');
    for (const f of [...files].sort((a, b) => cmp(a.path, b.path))) {
        hash.update(f.path);
        hash.update('\0');
        hash.update(f.content);
        hash.update('\0');
    }
    return hash.digest('hex');
}

function normalizeSignature(text: string, maxLen: number): string {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false);
    scanner.setText(text);
    let out = '';
    let tk = scanner.scan();
    while (tk !== ts.SyntaxKind.EndOfFileToken) {
        if (tk === ts.SyntaxKind.WhitespaceTrivia || tk === ts.SyntaxKind.NewLineTrivia) {
            if (out.length > 0 && !out.endsWith(' ')) out += ' ';
        } else if (
            tk !== ts.SyntaxKind.SingleLineCommentTrivia &&
            tk !== ts.SyntaxKind.MultiLineCommentTrivia
        ) {
            out += scanner.getTokenText();
        }
        tk = scanner.scan();
    }
    const trimmed = out.trim();
    return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
}

function extractSignature(node: ts.Node, sf: ts.SourceFile, maxLen: number): string {
    const start = node.getStart(sf);
    let end = node.getEnd();
    if (
        (ts.isFunctionDeclaration(node) ||
            ts.isMethodDeclaration(node) ||
            ts.isConstructorDeclaration(node) ||
            ts.isGetAccessorDeclaration(node) ||
            ts.isSetAccessorDeclaration(node)) &&
        node.body
    ) {
        end = node.body.getStart(sf);
    } else if (ts.isClassDeclaration(node) && node.members.pos > 0) {
        end = node.members.pos;
    }
    return normalizeSignature(sf.text.slice(start, end), maxLen);
}

function extractJSDoc(node: ts.Node): string {
    const attached = ts.getJSDocCommentsAndTags(node);
    const main = attached.find((n): n is ts.JSDoc => ts.isJSDoc(n));
    if (!main) return '';
    const commentText = readComment(main.comment);
    const firstPara = commentText.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
    const tags: string[] = [];
    let exampleUsed = false;
    for (const tag of main.tags ?? []) {
        const name = tag.tagName.text;
        if (name === 'param' || name === 'returns' || name === 'return') continue;
        const comment = readComment(tag.comment).replace(/\s+/g, ' ').trim();
        if (name === 'example') {
            if (exampleUsed) continue;
            exampleUsed = true;
            const snippet = comment.length > 80 ? `${comment.slice(0, 80)}…` : comment;
            tags.push(snippet ? `@example ${snippet}` : '@example');
        } else {
            tags.push(comment ? `@${name} ${comment}` : `@${name}`);
        }
    }
    return [firstPara, ...tags].filter(Boolean).join(' ');
}

function readComment(c: string | ts.NodeArray<ts.JSDocComment> | undefined): string {
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((part) => part.text ?? '').join('');
    return '';
}

function getLine(sf: ts.SourceFile, node: ts.Node): number {
    return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function isExported(node: ts.Node): boolean {
    return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function isDefault(node: ts.Node): boolean {
    return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Default) !== 0;
}

function asNamedDecl(stmt: ts.Statement): { decl: NamedDecl; kind: string; typeOnlyDecl: boolean } | undefined {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) return { decl: stmt, kind: 'function', typeOnlyDecl: false };
    if (ts.isClassDeclaration(stmt) && stmt.name) return { decl: stmt, kind: 'class', typeOnlyDecl: false };
    if (ts.isInterfaceDeclaration(stmt)) return { decl: stmt, kind: 'interface', typeOnlyDecl: true };
    if (ts.isTypeAliasDeclaration(stmt)) return { decl: stmt, kind: 'type', typeOnlyDecl: true };
    if (ts.isEnumDeclaration(stmt)) return { decl: stmt, kind: 'enum', typeOnlyDecl: false };
    return undefined;
}

function declName(decl: NamedDecl): string {
    return isDefault(decl) ? 'default' : decl.name!.text;
}

function collectClassMembers(sf: ts.SourceFile, decl: ts.ClassDeclaration): SymbolMember[] {
    const members: SymbolMember[] = [];
    for (const m of decl.members) {
        const line = getLine(sf, m);
        if (ts.isConstructorDeclaration(m)) members.push({ name: 'constructor', kind: 'constructor', line });
        else if (!m.name) continue;
        else if (ts.isMethodDeclaration(m)) members.push({ name: m.name.getText(sf), kind: 'method', line });
        else if (ts.isPropertyDeclaration(m)) members.push({ name: m.name.getText(sf), kind: 'property', line });
        else if (ts.isGetAccessorDeclaration(m)) members.push({ name: m.name.getText(sf), kind: 'getter', line });
        else if (ts.isSetAccessorDeclaration(m)) members.push({ name: m.name.getText(sf), kind: 'setter', line });
    }
    return members.sort((a, b) => a.line - b.line);
}

function buildFileEntry(sf: ts.SourceFile, relPath: string, maxLen: number): FileEntry {
    const symbols: FileSymbol[] = [];
    const imports: FileImport[] = [];
    const reExports: FileReExport[] = [];

    for (const stmt of sf.statements) {
        const named = asNamedDecl(stmt);
        if (named) {
            const exported = isExported(named.decl) || isDefault(named.decl);
            symbols.push({
                name: declName(named.decl),
                kind: named.kind,
                line: getLine(sf, named.decl),
                exported,
                signature: extractSignature(named.decl, sf, maxLen),
                ...(ts.isClassDeclaration(named.decl)
                    ? { members: collectClassMembers(sf, named.decl) }
                    : {}),
            });
            continue;
        }
        if (ts.isVariableStatement(stmt)) {
            const exported = isExported(stmt);
            for (const decl of stmt.declarationList.declarations) {
                if (!ts.isIdentifier(decl.name)) continue;
                symbols.push({
                    name: decl.name.text,
                    kind: 'variable',
                    line: getLine(sf, decl),
                    exported,
                    signature: normalizeSignature(sf.text.slice(stmt.getStart(sf), decl.getEnd()), maxLen),
                });
            }
            continue;
        }
        if (ts.isImportDeclaration(stmt)) {
            const names: string[] = [];
            if (stmt.importClause) {
                if (stmt.importClause.name) names.push('default');
                const nb = stmt.importClause.namedBindings;
                if (nb && ts.isNamespaceImport(nb)) names.push('*');
                else if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) names.push(el.name.text);
            }
            imports.push({ from: (stmt.moduleSpecifier as ts.StringLiteral).text, names: names.sort() });
            continue;
        }
        if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
            const from = (stmt.moduleSpecifier as ts.StringLiteral).text;
            const t = stmt.isTypeOnly;
            if (!stmt.exportClause) reExports.push({ from, name: '*', typeOnly: t });
            else if (ts.isNamespaceExport(stmt.exportClause))
                reExports.push({ from, name: stmt.exportClause.name.text, typeOnly: t });
            else if (ts.isNamedExports(stmt.exportClause))
                for (const el of stmt.exportClause.elements)
                    reExports.push({ from, name: el.name.text, typeOnly: t || el.isTypeOnly });
        }
    }

    return {
        path: relPath,
        symbols: symbols.sort((a, b) => a.line - b.line),
        imports: imports.sort((a, b) => cmp(a.from, b.from)),
        reExports: reExports.sort((a, b) => cmp(a.from, b.from) || cmp(a.name, b.name)),
    };
}

function resolveModuleToFile(from: string, importerAbs: string, files: Map<string, ts.SourceFile>): string | undefined {
    if (!from.startsWith('.')) return undefined;
    const base = resolve(dirname(importerAbs), from.replace(/\.js$/, ''));
    for (const candidate of [`${base}.ts`, resolve(base, 'index.ts')]) {
        const rel = toPosix(relative(ROOT, candidate));
        if (files.has(rel)) return rel;
    }
    return undefined;
}

interface ResolveContext {
    sourceFiles: Map<string, ts.SourceFile>;
    maxLen: number;
}

function buildApiEntry(
    sf: ts.SourceFile,
    relPath: string,
    publicName: string,
    decl: NamedDecl,
    kind: string,
    typeOnly: boolean,
    maxLen: number,
): PublicApiEntry {
    return {
        name: publicName,
        kind,
        file: relPath,
        line: getLine(sf, decl),
        signature: extractSignature(decl, sf, maxLen),
        jsdoc: extractJSDoc(decl),
        typeOnly,
    };
}

function findLocalApiEntries(
    relPath: string,
    typeOnlyHint: boolean,
    ctx: ResolveContext,
): PublicApiEntry[] {
    const sf = ctx.sourceFiles.get(relPath);
    if (!sf) return [];
    const entries: PublicApiEntry[] = [];
    for (const stmt of sf.statements) {
        const named = asNamedDecl(stmt);
        if (named && (isExported(named.decl) || isDefault(named.decl))) {
            entries.push(
                buildApiEntry(
                    sf,
                    relPath,
                    declName(named.decl),
                    named.decl,
                    named.kind,
                    typeOnlyHint || named.typeOnlyDecl,
                    ctx.maxLen,
                ),
            );
            continue;
        }
        if (ts.isVariableStatement(stmt) && isExported(stmt)) {
            for (const decl of stmt.declarationList.declarations) {
                if (!ts.isIdentifier(decl.name)) continue;
                entries.push({
                    name: decl.name.text,
                    kind: 'variable',
                    file: relPath,
                    line: getLine(sf, decl),
                    signature: normalizeSignature(sf.text.slice(stmt.getStart(sf), decl.getEnd()), ctx.maxLen),
                    jsdoc: extractJSDoc(stmt),
                    typeOnly: typeOnlyHint,
                });
            }
        }
    }
    return entries;
}

function collectPublicApi(
    relPath: string,
    typeOnlyHint: boolean,
    depth: number,
    visited: Set<string>,
    ctx: ResolveContext,
): PublicApiEntry[] {
    if (depth > 8 || visited.has(relPath)) return [];
    const nextVisited = new Set(visited).add(relPath);
    const sf = ctx.sourceFiles.get(relPath);
    if (!sf) return [];
    const importerAbs = resolve(ROOT, relPath);

    const entries: PublicApiEntry[] = [...findLocalApiEntries(relPath, typeOnlyHint, ctx)];

    for (const stmt of sf.statements) {
        if (!ts.isExportDeclaration(stmt) || !stmt.moduleSpecifier) continue;
        const target = resolveModuleToFile(
            (stmt.moduleSpecifier as ts.StringLiteral).text,
            importerAbs,
            ctx.sourceFiles,
        );
        if (!target) continue;
        const t = typeOnlyHint || stmt.isTypeOnly;

        if (!stmt.exportClause) {
            entries.push(...collectPublicApi(target, t, depth + 1, nextVisited, ctx));
            continue;
        }
        if (ts.isNamespaceExport(stmt.exportClause)) {
            entries.push({
                name: stmt.exportClause.name.text,
                kind: 'namespace',
                file: target,
                line: getLine(sf, stmt),
                signature: `export * as ${stmt.exportClause.name.text} from '${target}'`,
                jsdoc: '',
                typeOnly: t,
            });
            continue;
        }
        if (ts.isNamedExports(stmt.exportClause)) {
            const downstream = collectPublicApi(target, t, depth + 1, nextVisited, ctx);
            for (const el of stmt.exportClause.elements) {
                const localName = el.propertyName?.text ?? el.name.text;
                const publicName = el.name.text;
                const elTypeOnly = t || el.isTypeOnly;
                const match = downstream.find((e) => e.name === localName);
                if (match) entries.push({ ...match, name: publicName, typeOnly: elTypeOnly || match.typeOnly });
            }
        }
    }
    return entries;
}

async function generate(): Promise<{ markdown: string }> {
    const config = loadConfig();
    const repo = loadRepoMeta();
    const absoluteFiles = await discoverSources(config);

    const sourceFiles = new Map<string, ts.SourceFile>();
    const fileEntries = new Map<string, FileEntry>();
    const rawForHash: { path: string; content: string }[] = [];

    for (const abs of absoluteFiles) {
        const rel = toPosix(relative(ROOT, abs));
        const content = await fsPromises.readFile(abs, 'utf8');
        rawForHash.push({ path: rel, content });
        const sf = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, true);
        sourceFiles.set(rel, sf);
        fileEntries.set(rel, buildFileEntry(sf, rel, config.maxSignatureLength));
    }

    const ctx: ResolveContext = { sourceFiles, maxLen: config.maxSignatureLength };
    const collected: PublicApiEntry[] = [];
    for (const entry of config.entrypoints) {
        collected.push(...collectPublicApi(entry, false, 0, new Set(), ctx));
    }
    const seen = new Set<string>();
    const publicApi = collected
        .filter((e) => {
            const key = `${e.name}\0${e.file}\0${e.line}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => cmp(a.name, b.name) || cmp(a.file, b.file));

    const codemap: Codemap = {
        schema: 'codemap.v2',
        repo,
        sourceHash: computeSourceHash(rawForHash),
        entrypoints: [...config.entrypoints].sort(),
        publicApi,
        files: [...fileEntries.values()].sort((a, b) => cmp(a.path, b.path)),
    };

    return { markdown: `${HEADER}\n\`\`\`json\n${JSON.stringify(codemap, null, 2)}\n\`\`\`\n` };
}

function unifiedDiff(expected: string, actual: string, maxLines: number): string {
    const a = expected.split('\n');
    const b = actual.split('\n');
    const out: string[] = [];
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len && out.length < maxLines; i += 1) {
        if (a[i] === b[i]) continue;
        if (i < a.length) out.push(`-${a[i]}`);
        if (out.length < maxLines && i < b.length) out.push(`+${b[i]}`);
    }
    return out.join('\n');
}

async function main(): Promise<number> {
    const check = process.argv.includes('--check');
    const { markdown } = await generate();
    if (!check) {
        await fsPromises.writeFile(OUTPUT_PATH, markdown, 'utf8');
        process.stdout.write('✓ CODEMAP.md regenerated\n');
        return 0;
    }
    let existing = '';
    try {
        existing = await fsPromises.readFile(OUTPUT_PATH, 'utf8');
    } catch {
        existing = '';
    }
    if (existing === markdown) {
        process.stdout.write('✓ CODEMAP.md is up to date\n');
        return 0;
    }
    process.stderr.write(unifiedDiff(existing, markdown, 40));
    process.stderr.write('\n✗ CODEMAP.md is stale. Run `npm run codemap` and commit the result.\n');
    return 1;
}

export { generate, loadConfig };

if (require.main === module) {
    void main().then((code) => process.exit(code));
}
