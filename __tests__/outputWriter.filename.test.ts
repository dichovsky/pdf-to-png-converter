import { sep } from 'node:path';
import { expect, test } from 'vitest';
import { assertValidOutputFilename, savePNGfile } from '../src/outputWriter';

test.each(['', '.', '..'])('rejects the disk path alias %j during filename preflight', (name) => {
    expect(() => assertValidOutputFilename(name)).toThrow(/non-empty|plain filename|escapes the output folder/);
});

test('rejects the host path separator and accepts a plain filename', () => {
    expect(() => assertValidOutputFilename(`sub${sep}page.png`)).toThrow('path separators');
    expect(() => assertValidOutputFilename('page.png')).not.toThrow();
});

test.skipIf(sep === '\\')('accepts backslash on POSIX, where it is a filename character', () => {
    expect(() => assertValidOutputFilename('foo\\bar.png')).not.toThrow();
});

test('rejects NUL on every host', () => {
    expect(() => assertValidOutputFilename('page\0.png')).toThrow('must not contain a NUL byte');
});

test.skipIf(sep === '\\')('keeps Windows-only spellings valid on POSIX', () => {
    for (const name of [
        'report:stream.png',
        'question?.png',
        'star*.png',
        'less<than.png',
        'greater>than.png',
        'pipe|name.png',
        'quote"name.png',
        'control\u0001name.png',
        'CON.png',
        'NUL',
        'LPT9.txt',
        'trailing-dot.',
        'trailing-space ',
    ]) {
        expect(() => assertValidOutputFilename(name)).not.toThrow();
    }
});

test('savePNGfile repeats filename validation before any filesystem operation', async () => {
    // No such folder exists, so reaching realpath/open would change this into an ENOENT failure.
    const folder = { resolvedOutputFolder: '/definitely-not-a-real-pdf-to-png-test-folder', realOutputFolder: '/not-used' };

    await expect(savePNGfile('.', Buffer.alloc(0), folder)).rejects.toThrow('plain filename');
    await expect(savePNGfile('page\0.png', Buffer.alloc(0), folder)).rejects.toThrow('must not contain a NUL byte');
});

test('savePNGfile rejects non-Buffer content before filesystem access', async () => {
    const folder = { resolvedOutputFolder: '/definitely-not-a-real-pdf-to-png-test-folder', realOutputFolder: '/not-used' };
    const invalidContent = new Uint8Array([1]) as unknown as Buffer;

    await expect(savePNGfile('page.png', invalidContent, folder)).rejects.toThrow('content is not a Buffer');
});
