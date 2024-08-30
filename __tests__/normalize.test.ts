import { expect, test } from 'vitest';
import { normalizePath } from '../src/normalize.path';
import { resolve } from 'path';

test('should normalize path ending with slash', () => {
    const path = '/path/to/folder/';
    const normalizedPath: string = normalizePath(path);
    expect(normalizedPath).to.equal('/path/to/folder/');
});

test('should normalize path without ending slash', () => {
    const path = '/path/to/folder';
    const normalizedPath: string = normalizePath(path);
    expect(normalizedPath).to.equal('/path/to/folder/');
});

test('should normalize empty path', () => {
    const path = '';
    const normalizedPath: string = normalizePath(path);
    expect(normalizedPath).to.equal(`${resolve('./')}/`);
});

test('should normalize root path', () => {
    const path = '/';
    const normalizedPath: string = normalizePath(path);
    expect(normalizedPath).to.equal('/');
});