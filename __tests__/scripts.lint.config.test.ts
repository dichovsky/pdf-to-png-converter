import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { expect, test } from 'vitest';

const root = resolve(__dirname, '..');
const lintCli = join(dirname(require.resolve('oxlint/package.json')), 'bin', 'oxlint');

test('Oxlint discovers all maintained TypeScript files', () => {
    const files = execFileSync(process.execPath, [lintCli, '--debug=files', '.'], { cwd: root, encoding: 'utf8' })
        .split(/\r?\n/)
        .map((name) => relative(root, resolve(root, name)));
    for (const dir of ['src', '__tests__', 'scripts']) {
        for (const name of readdirSync(join(root, dir)).filter((entry) => /\.[cm]?ts$/.test(entry))) {
            expect(files).toContain(join(dir, name));
        }
    }
    expect(files).toContain('vitest.config.mts');
});

test('the lint gate includes type-aware rules and fails on warnings', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: { lint: string } };
    expect(manifest.scripts.lint.split(' ')).toEqual(expect.arrayContaining(['--type-aware', '--deny-warnings']));
    const config = JSON.parse(execFileSync(process.execPath, [lintCli, '--print-config', 'src/pdfToPng.ts'], { cwd: root, encoding: 'utf8' }));
    expect(config.rules['typescript/no-floating-promises']).toContain('deny');
});
