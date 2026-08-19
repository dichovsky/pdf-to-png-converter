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

test.each([
    'page:stream.png',
    'C:page.png',
    'question?.png',
    'star*.png',
    'less<than.png',
    'greater>than.png',
    'pipe|name.png',
    'quote"name.png',
])('rejects a Windows-invalid filename character in %j', (name) => {
    expect(() => assertValidOutputFilename(name)).toThrow('contains a character that is invalid on Windows');
});

test('rejects non-NUL control characters under Windows semantics', () => {
    expect(() => assertValidOutputFilename('control\u0001name.png')).toThrow('contains a character that is invalid on Windows');
});

test.each([
    'CON',
    'con.png',
    'PRN.txt',
    'AUX.backup.png',
    'NUL',
    'COM1.png',
    'com9.log',
    'LPT1',
    'lpt9.txt',
    'CONIN$.png',
    'conout$.log',
    'CON .png',
])('rejects the reserved Windows device basename in %j', (name) => {
    expect(() => assertValidOutputFilename(name)).toThrow('reserved Windows device basename');
});

test.each(['page.png.', 'page.png '])('rejects a Windows filename ending with a dot or space: %j', (name) => {
    expect(() => assertValidOutputFilename(name)).toThrow('must not end with a dot or space on Windows');
});

test('rejects NUL before any filesystem operation under Windows semantics', () => {
    expect(() => assertValidOutputFilename('page\0.png')).toThrow('must not contain a NUL byte');
});

test.each(['COM0.png', 'COM10.png', 'LPT0.txt', 'LPT10.txt', 'console.png'])('accepts non-device Windows basenames: %j', (name) => {
    expect(() => assertValidOutputFilename(name)).not.toThrow();
});

test('rejects current and parent directory aliases before filesystem I/O', () => {
    expect(() => assertValidOutputFilename('.')).toThrow('plain filename');
    expect(() => assertValidOutputFilename('..')).toThrow('escapes the output folder');
});
