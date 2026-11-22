import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

test('a maintenance script invoked through a directory link runs its main function', () => {
    const root = mkdtempSync(join(tmpdir(), 'converter-entry-'));
    try {
        const scripts = join(root, 'scripts');
        symlinkSync(resolve(__dirname, '../scripts'), scripts, process.platform === 'win32' ? 'junction' : 'dir');
        const result = spawnSync(process.execPath, [join(scripts, 'generate-wasm-fixtures.ts'), '--invalid'], { encoding: 'utf8' });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(2);
        expect(result.stderr).toContain('--invalid');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
