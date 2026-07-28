import { promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { prepareOutputFolder, resolveOutputFolder, savePNGfile } from '../src/outputWriter';

// ARCH-012: folder resolution, creation, and the realpath baseline are owned by outputWriter.ts,
// so the SEC-001/002/003 threat model lives in one module alongside the per-write re-check that
// consumes the baseline.

test('resolveOutputFolder resolves a relative path against the current cwd', () => {
    const relativeFolder = join('test-results', 'resolve-probe');
    expect(resolveOutputFolder(relativeFolder)).toBe(resolve(relativeFolder));
});

test('prepareOutputFolder creates the resolved folder recursively', async () => {
    const baseDir = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-handle-'));
    const nested = join(baseDir, 'a', 'b', 'c');

    try {
        const handle = await prepareOutputFolder(resolveOutputFolder(relative(process.cwd(), nested)));

        expect(handle.resolvedOutputFolder).toBe(resolve(nested));
        expect((await fsPromises.stat(nested)).isDirectory()).toBe(true);
    } finally {
        await fsPromises.rm(baseDir, { recursive: true, force: true });
    }
});

test('prepareOutputFolder captures the realpath baseline, resolving symlinked ancestors', async () => {
    const baseDir = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-handle-'));
    const realTarget = join(baseDir, 'real');
    const linkPath = join(baseDir, 'link');

    try {
        await fsPromises.mkdir(realTarget);
        await fsPromises.symlink(realTarget, linkPath, 'dir');

        const handle = await prepareOutputFolder(resolveOutputFolder(linkPath));

        // The resolved path keeps the caller's spelling; the baseline is the dereferenced target,
        // which is what every write compares a fresh realpath against.
        expect(handle.resolvedOutputFolder).toBe(resolve(linkPath));
        expect(handle.realOutputFolder).toBe(await fsPromises.realpath(realTarget));
    } finally {
        await fsPromises.rm(baseDir, { recursive: true, force: true });
    }
});

test('savePNGfile rejects a write whose folder no longer matches the handle baseline', async () => {
    const baseDir = await fsPromises.mkdtemp(join(tmpdir(), 'pdf-to-png-handle-'));

    try {
        const handle = await prepareOutputFolder(resolveOutputFolder(baseDir));
        // Simulates the folder being swapped or renamed after the baseline was captured.
        const tampered = { ...handle, realOutputFolder: join(handle.realOutputFolder, 'elsewhere') };

        await expect(savePNGfile('page.png', Buffer.alloc(1), tampered)).rejects.toThrow(/Output folder was modified during write/);
    } finally {
        await fsPromises.rm(baseDir, { recursive: true, force: true });
    }
});
