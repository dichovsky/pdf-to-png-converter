import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const PROJECT_ROOT = resolve(__dirname, '..');
const SCRIPT_PATH = join(PROJECT_ROOT, 'scripts/generate-codemap.ts');
const TS_NODE_PROJECT = join(PROJECT_ROOT, 'tsconfig.json');
const localRequire = createRequire(__filename);
const TS_NODE_REGISTER = localRequire.resolve('ts-node/register');

interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}

function runScript(cwd: string, args: string[] = []): RunResult {
    const result = spawnSync(process.execPath, ['-r', TS_NODE_REGISTER, SCRIPT_PATH, ...args], {
        cwd,
        encoding: 'utf8',
        env: {
            ...process.env,
            TS_NODE_PROJECT,
            TS_NODE_TRANSPILE_ONLY: 'true',
            TS_NODE_COMPILER_OPTIONS: JSON.stringify({
                module: 'CommonJS',
                target: 'ES2022',
                moduleResolution: 'Bundler',
                esModuleInterop: true,
                skipLibCheck: true,
            }),
        },
    });
    return {
        code: result.status ?? -1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

const DEFAULT_CONFIG = {
    sourceDirs: ['src'],
    entrypoints: ['src/index.ts'],
    exclude: ['**/*.test.ts', '**/*.spec.ts', '__tests__/**'],
    maxSignatureLength: 200,
};

const DEFAULT_PKG = { name: 'fixture-pkg', version: '0.0.0' };

interface FixtureSpec {
    config?: Record<string, unknown>;
    pkg?: Record<string, unknown>;
    files: Record<string, string>;
}

async function makeFixture(spec: FixtureSpec): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'codemap-test-'));
    await writeFile(join(dir, 'codemap.config.json'), JSON.stringify(spec.config ?? DEFAULT_CONFIG, null, 2));
    await writeFile(join(dir, 'package.json'), JSON.stringify(spec.pkg ?? DEFAULT_PKG, null, 2));
    for (const [relPath, content] of Object.entries(spec.files)) {
        const abs = join(dir, relPath);
        await mkdir(resolve(abs, '..'), { recursive: true });
        await writeFile(abs, content);
    }
    return dir;
}

function parseJsonBlock(markdown: string): Record<string, unknown> {
    const match = markdown.match(/```json\n([\s\S]+?)\n```/);
    if (!match) throw new Error('No json block in CODEMAP.md');
    return JSON.parse(match[1]) as Record<string, unknown>;
}

const createdDirs: string[] = [];
afterEach(async () => {
    while (createdDirs.length > 0) {
        const dir = createdDirs.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

async function fixture(spec: FixtureSpec): Promise<string> {
    const dir = await makeFixture(spec);
    createdDirs.push(dir);
    return dir;
}

describe('generate-codemap', () => {
    test('produces byte-identical output on consecutive runs (determinism)', async () => {
        const dir = await fixture({
            files: {
                'src/index.ts': "export { foo } from './foo.js';\nexport type { Opts } from './foo.js';\n",
                'src/foo.ts': 'export interface Opts { x: number }\nexport function foo(o: Opts): number { return o.x; }\n',
            },
        });
        const first = runScript(dir);
        expect(first.code).toBe(0);
        const firstContent = await readFile(join(dir, 'CODEMAP.md'), 'utf8');
        const second = runScript(dir);
        expect(second.code).toBe(0);
        const secondContent = await readFile(join(dir, 'CODEMAP.md'), 'utf8');
        expect(secondContent).toBe(firstContent);
    });

    test('--check exits 0 when fresh and 1 when stale', async () => {
        const dir = await fixture({
            files: {
                'src/index.ts': "export { greet } from './greet.js';\n",
                'src/greet.ts': "export function greet(name: string): string { return 'hi ' + name; }\n",
            },
        });
        runScript(dir);
        const fresh = runScript(dir, ['--check']);
        expect(fresh.code).toBe(0);
        expect(fresh.stdout).toContain('up to date');

        await writeFile(
            join(dir, 'src/greet.ts'),
            "export function greet(name: string): string { return 'hello ' + name; }\nexport const VERSION = '1';\n",
        );
        const stale = runScript(dir, ['--check']);
        expect(stale.code).toBe(1);
        expect(stale.stderr).toContain('CODEMAP.md is stale');
    });

    test('exclude globs drop matching files from output', async () => {
        const dir = await fixture({
            files: {
                'src/index.ts': "export { keep } from './keep.js';\n",
                'src/keep.ts': 'export function keep(): number { return 1; }\n',
                'src/keep.test.ts': "import { keep } from './keep.js';\nexport function shouldNotAppear(): number { return keep(); }\n",
            },
        });
        runScript(dir);
        const codemap = parseJsonBlock(await readFile(join(dir, 'CODEMAP.md'), 'utf8'));
        const files = codemap.files as { path: string }[];
        const paths = files.map((f) => f.path);
        expect(paths).toContain('src/keep.ts');
        expect(paths).not.toContain('src/keep.test.ts');
    });

    test('extracts JSDoc first paragraph and preserved tags into publicApi entries', async () => {
        const dir = await fixture({
            files: {
                'src/index.ts': "export { doThing } from './thing.js';\n",
                'src/thing.ts': `/**
 * Does the thing.
 *
 * Detailed second paragraph that should be dropped.
 *
 * @param x ignored description
 * @returns ignored description
 * @deprecated use doNewThing
 */
export function doThing(x: number): void {
    void x;
}
`,
            },
        });
        runScript(dir);
        const codemap = parseJsonBlock(await readFile(join(dir, 'CODEMAP.md'), 'utf8'));
        const api = codemap.publicApi as { name: string; jsdoc: string }[];
        const entry = api.find((e) => e.name === 'doThing');
        expect(entry).toBeDefined();
        expect(entry!.jsdoc).toContain('Does the thing.');
        expect(entry!.jsdoc).not.toContain('second paragraph');
        expect(entry!.jsdoc).toContain('@deprecated');
        expect(entry!.jsdoc).not.toContain('@param');
        expect(entry!.jsdoc).not.toContain('@returns');
    });

    test('resolves transitive re-exports through barrel files', async () => {
        const dir = await fixture({
            files: {
                'src/index.ts': "export * from './barrel.js';\n",
                'src/barrel.ts': "export { deep } from './nested/deep.js';\nexport type { DeepOpts } from './nested/deep.js';\n",
                'src/nested/deep.ts':
                    'export interface DeepOpts { tag: string }\nexport function deep(o: DeepOpts): string { return o.tag; }\n',
            },
        });
        runScript(dir);
        const codemap = parseJsonBlock(await readFile(join(dir, 'CODEMAP.md'), 'utf8'));
        const api = codemap.publicApi as { name: string; file: string; kind: string; typeOnly: boolean }[];
        const deepFn = api.find((e) => e.name === 'deep');
        expect(deepFn).toBeDefined();
        expect(deepFn!.file).toBe('src/nested/deep.ts');
        expect(deepFn!.kind).toBe('function');
        expect(deepFn!.typeOnly).toBe(false);
        const deepOpts = api.find((e) => e.name === 'DeepOpts');
        expect(deepOpts).toBeDefined();
        expect(deepOpts!.typeOnly).toBe(true);
        expect(deepOpts!.file).toBe('src/nested/deep.ts');
    });
});
