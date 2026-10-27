import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = join(__dirname, '..');
const eslint = new ESLint({ cwd: REPO_ROOT });

// `calculateConfigForFile` returns the resolved severity as `[0]`/`[2]` (or the string form), so normalise both.
function severityOf(rule: unknown): unknown {
    return Array.isArray(rule) ? rule[0] : rule;
}

describe('lint gate', () => {
    test('every file in scripts/ gets a lint configuration instead of being silently skipped', async () => {
        const scripts = readdirSync(join(REPO_ROOT, 'scripts')).filter((name) => name.endsWith('.ts'));
        expect(scripts.length).toBeGreaterThan(0);
        for (const name of scripts) {
            expect(await eslint.calculateConfigForFile(`scripts/${name}`), `scripts/${name} is not linted`).toBeDefined();
        }
    });

    test.each(['src/pdfToPng.ts', '__tests__/cli.test.ts', 'scripts/release-postcheck.ts', 'scripts/benchmark.ts'])(
        'leaves undefined names and redeclarations to tsc in %s',
        async (file) => {
            const config = await eslint.calculateConfigForFile(file);
            // tsc reports both, and the core rules reject valid Node globals (setTimeout, URL) and TypeScript overloads.
            expect([0, 'off']).toContain(severityOf(config.rules['no-undef']));
            expect([0, 'off']).toContain(severityOf(config.rules['no-redeclare']));
            // The rest of typescript-eslint's `eslint-recommended` preset is applied, and unreachable code stays an error.
            expect([2, 'error']).toContain(severityOf(config.rules['prefer-const']));
            expect([2, 'error']).toContain(severityOf(config.rules['no-unreachable']));
        },
    );

    test('the lint script fails on warnings', () => {
        const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as { scripts: { lint: string } };
        expect(manifest.scripts.lint).toMatch(/(^|\s)--max-warnings 0(\s|$)/);
    });
});
