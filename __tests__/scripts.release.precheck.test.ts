import { describe, expect, test } from 'vitest';
import type { PackageManifest } from '../scripts/release-precheck';
import { hasNodeShebang, requiredTarballFiles, tarballProblems } from '../scripts/release-precheck';

const BASE_FILES = ['out/index.js', 'out/index.d.ts', 'out/types.d.ts', 'out/cli.js', 'out/pageRenderWorker.js'];
const SHEBANG_SOURCE = '#!/usr/bin/env node\n"use strict";\n';

function manifest(fields: Partial<PackageManifest> = {}): PackageManifest {
    return { name: 'pkg', version: '1.0.0', ...fields };
}

function packedFiles(...extra: string[]): string[] {
    return ['LICENSE', 'README.md', 'package.json', ...BASE_FILES, ...extra];
}

describe('requiredTarballFiles', () => {
    test('always requires the build output the library cannot load without', () => {
        expect(requiredTarballFiles(manifest())).toEqual(BASE_FILES);
    });

    test('adds the main, types, bin and exports targets the manifest declares', () => {
        const required = requiredTarballFiles(
            manifest({
                main: 'out/indx.js',
                types: 'out/typo.d.ts',
                bin: { tool: 'out/cli-typo.js' },
                exports: { '.': { types: './out/exp.d.ts', require: './out/exp.js' } },
            }),
        );

        expect(required).toEqual([...BASE_FILES, 'out/indx.js', 'out/typo.d.ts', 'out/cli-typo.js', 'out/exp.d.ts', 'out/exp.js']);
    });

    test('accepts bin as a plain string', () => {
        expect(requiredTarballFiles(manifest({ bin: 'out/other-cli.js' }))).toEqual([...BASE_FILES, 'out/other-cli.js']);
    });

    test('follows conditions, subpath maps and fallback arrays in exports and skips blocked subpaths', () => {
        const required = requiredTarballFiles(
            manifest({
                exports: {
                    '.': { import: './out/esm.mjs', require: ['./out/a.js', './out/b.js'] },
                    './sub': './out/sub.js',
                    './blocked': null,
                },
            }),
        );

        expect(required).toEqual([...BASE_FILES, 'out/esm.mjs', 'out/a.js', 'out/b.js', 'out/sub.js']);
    });

    test('skips subpath patterns because they name a set of files rather than one file', () => {
        expect(requiredTarballFiles(manifest({ exports: { './*': './out/*.js' } }))).toEqual(BASE_FILES);
    });

    test('normalises targets to the paths npm pack prints', () => {
        const required = requiredTarballFiles(manifest({ main: './out/x.js', types: 'out\\y.d.ts', bin: 'out//z.js' }));

        expect(required).toEqual([...BASE_FILES, 'out/x.js', 'out/y.d.ts', 'out/z.js']);
    });

    test('lists each file once', () => {
        expect(requiredTarballFiles(manifest({ main: 'out/index.js', exports: { '.': './out/index.js' } }))).toEqual(BASE_FILES);
    });

    test('ignores entry fields that are not strings, arrays or objects of strings', () => {
        expect(requiredTarballFiles(manifest({ main: 42, types: null, bin: [1], exports: true }))).toEqual(BASE_FILES);
    });
});

describe('hasNodeShebang', () => {
    test.each([
        ['LF line ending', '#!/usr/bin/env node\n"use strict";'],
        ['CRLF line ending', '#!/usr/bin/env node\r\n"use strict";'],
        ['nothing after the shebang', '#!/usr/bin/env node'],
    ])('accepts a file starting with the node shebang (%s)', (_name, source) => {
        expect(hasNodeShebang(source)).toBe(true);
    });

    test.each([
        ['no shebang', '"use strict";\n'],
        ['a different interpreter', '#!/usr/bin/env python\n'],
        ['extra interpreter arguments', '#!/usr/bin/env node --no-warnings\n'],
        ['a blank line before the shebang', '\n#!/usr/bin/env node\n'],
        ['the shebang not on the first line', '"use strict";\n#!/usr/bin/env node\n'],
        ['an empty file', ''],
    ])('rejects a file with %s', (_name, source) => {
        expect(hasNodeShebang(source)).toBe(false);
    });
});

describe('tarballProblems', () => {
    const withCli = manifest({ main: 'out/index.js', bin: { tool: 'out/cli.js' } });

    test('reports nothing for a complete tarball whose bin file has the shebang', () => {
        expect(tarballProblems(packedFiles(), withCli, () => SHEBANG_SOURCE)).toEqual([]);
    });

    test('reports a bin target that is not in the tarball and does not try to read it', () => {
        const reads: string[] = [];
        const problems = tarballProblems(packedFiles(), manifest({ bin: { tool: 'out/cli-typo.js' } }), (file) => {
            reads.push(file);
            return SHEBANG_SOURCE;
        });

        expect(problems).toEqual(['P4 tarball is missing required files: out/cli-typo.js']);
        expect(reads).toEqual([]);
    });

    test('reports main, types and exports targets that are not in the tarball', () => {
        const problems = tarballProblems(
            packedFiles(),
            manifest({ main: 'out/indx.js', types: './out/typo.d.ts', exports: { '.': { require: './out/exp.js' } } }),
            () => SHEBANG_SOURCE,
        );

        expect(problems).toEqual(['P4 tarball is missing required files: out/indx.js, out/typo.d.ts, out/exp.js']);
    });

    test('still reports the fixed build output when it is missing', () => {
        const files = packedFiles().filter((file) => file !== 'out/pageRenderWorker.js');

        expect(tarballProblems(files, withCli, () => SHEBANG_SOURCE)).toEqual([
            'P4 tarball is missing required files: out/pageRenderWorker.js',
        ]);
    });

    test('still reports source, tests, build metadata and stray TypeScript', () => {
        const files = packedFiles('src/index.ts', '__tests__/a.test.ts', 'tsconfig.tsbuildinfo', 'out/stray.ts', 'out/extra.d.ts');

        expect(tarballProblems(files, withCli, () => SHEBANG_SOURCE)).toEqual([
            'P4 tarball contains files that should not ship: src/index.ts, __tests__/a.test.ts, tsconfig.tsbuildinfo, out/stray.ts',
        ]);
    });

    test('reports a bin file that does not start with the node shebang', () => {
        expect(tarballProblems(packedFiles(), withCli, () => '"use strict";\n')).toEqual([
            'P4 bin file out/cli.js does not start with "#!/usr/bin/env node"',
        ]);
    });

    test('reports a bin file that cannot be read', () => {
        const problems = tarballProblems(packedFiles(), withCli, () => {
            throw new Error('EACCES: permission denied');
        });

        expect(problems).toEqual(['P4 could not read bin file out/cli.js to check its shebang: EACCES: permission denied']);
    });

    test('reports a non-Error read failure by its text', () => {
        const problems = tarballProblems(packedFiles(), withCli, () => {
            throw 'disk gone';
        });

        expect(problems).toEqual(['P4 could not read bin file out/cli.js to check its shebang: disk gone']);
    });

    test('checks every packed bin target', () => {
        const twoBins = manifest({ bin: { good: 'out/cli.js', bad: 'out/other.js' } });
        const problems = tarballProblems(packedFiles('out/other.js'), twoBins, (file) =>
            file === 'out/cli.js' ? SHEBANG_SOURCE : '// no shebang\n',
        );

        expect(problems).toEqual(['P4 bin file out/other.js does not start with "#!/usr/bin/env node"']);
    });

    test('accumulates every problem in a stable order', () => {
        const files = packedFiles('src/index.ts').filter((file) => file !== 'out/pageRenderWorker.js');
        const problems = tarballProblems(files, withCli, () => '');

        expect(problems).toEqual([
            'P4 tarball is missing required files: out/pageRenderWorker.js',
            'P4 tarball contains files that should not ship: src/index.ts',
            'P4 bin file out/cli.js does not start with "#!/usr/bin/env node"',
        ]);
    });
});
