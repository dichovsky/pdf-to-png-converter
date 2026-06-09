import { expect, test, vi } from 'vitest';
import { CMAP_RELATIVE_URL, STANDARD_FONTS_RELATIVE_URL } from '../src/const.js';
import { normalizePath } from '../src/normalizePath.js';

// Regression guard for issue #173: on Windows, `normalizePath` previously appended
// the OS separator (`\`) to the pdf.js factory URLs (`cMapUrl` / `standardFontDataUrl`),
// which pdf.js rejects with `Invalid factory url ... must include trailing slash.`.
// CI only runs on ubuntu-latest, so the Windows separator never surfaced there.
//
// This test forces Windows path semantics on any host by binding `node:path` to
// `path.win32`, then asserts the pdf.js contract directly: the value must end with a
// forward slash `/` and contain no backslashes. The buggy `${sep}` implementation
// produces a `\`-terminated string and fails this test on Linux/macOS.
//
// `vi.mock` is hoisted above the imports above by Vitest, so `normalizePath` binds to
// the win32 path implementation.
vi.mock('node:path', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:path')>();
    return { ...actual.win32, default: actual.win32 };
});

test('cMapUrl is a forward-slash, trailing-slash factory URL under Windows path semantics', () => {
    const result: string = normalizePath(CMAP_RELATIVE_URL);
    expect(result.endsWith('/')).toBe(true);
    expect(result).not.toContain('\\');
});

test('standardFontDataUrl is a forward-slash, trailing-slash factory URL under Windows path semantics', () => {
    const result: string = normalizePath(STANDARD_FONTS_RELATIVE_URL);
    expect(result.endsWith('/')).toBe(true);
    expect(result).not.toContain('\\');
});
