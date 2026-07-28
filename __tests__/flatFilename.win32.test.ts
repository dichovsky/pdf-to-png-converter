import { expect, test, vi } from 'vitest';
import { containsPathSeparator, SEPARATOR_DESCRIPTION } from '../src/flatFilename.js';

// ARCH-016: the flat-filename predicate is host-dependent — on Windows both "\" and "/" are
// separators, while on POSIX "\" is a legal filename character (PDFs named `foo\bar.pdf` must
// still convert). CI runs on Linux only, so the Windows arm is never exercised there.
//
// Binding `node:path` to `path.win32` forces Windows semantics on any host. `vi.mock` is hoisted
// above the imports above, so `flatFilename` binds to the win32 `sep`.
vi.mock('node:path', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:path')>();
    return { ...actual.win32, default: actual.win32 };
});

test('rejects both "/" and "\\" under Windows path semantics', () => {
    expect(containsPathSeparator('sub/page.png')).toBe(true);
    expect(containsPathSeparator('sub\\page.png')).toBe(true);
});

test('accepts a flat filename under Windows path semantics', () => {
    expect(containsPathSeparator('page_1.png')).toBe(false);
});

test('names both separators in the error description under Windows path semantics', () => {
    expect(SEPARATOR_DESCRIPTION).toBe('"/" or "\\"');
});
