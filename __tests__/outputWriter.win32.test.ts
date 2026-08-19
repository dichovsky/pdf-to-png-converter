import { expect, test, vi } from 'vitest';
import { assertValidOutputFilename } from '../src/outputWriter.js';

// CI commonly runs on POSIX. Bind node:path to win32 so the output boundary's host-specific
// separator contract is exercised on every platform.
vi.mock('node:path', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:path')>();
    return { ...actual.win32, default: actual.win32 };
});

test('rejects both path separators under Windows semantics', () => {
    expect(() => assertValidOutputFilename('sub/page.png')).toThrow('without "/" or "\\" path separators');
    expect(() => assertValidOutputFilename('sub\\page.png')).toThrow('without "/" or "\\" path separators');
});

test('accepts a flat filename under Windows semantics', () => {
    expect(() => assertValidOutputFilename('page_1.png')).not.toThrow();
});

test('rejects current and parent directory aliases before filesystem I/O', () => {
    expect(() => assertValidOutputFilename('.')).toThrow('plain filename');
    expect(() => assertValidOutputFilename('..')).toThrow('escapes the output folder');
});
