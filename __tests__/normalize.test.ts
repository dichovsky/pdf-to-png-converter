import { expect, test } from 'vitest';
import { normalizePath } from '../src/normalize.path';

test('should normalize path ending with slash', () => {
    const path = '/path/to/folder/';
    const normalizedPath: string = normalizePath(path);
    if (process.platform === 'win32') {
        expect(normalizedPath).to.equal('C:\\path\\to\\folder\\');
    } else {
        expect(normalizedPath).to.equal('/path/to/folder/');
    }
});

test('should normalize path without ending slash', () => {
    const path = '/path/to/folder';
    const normalizedPath: string = normalizePath(path);
    if (process.platform === 'win32') {
        expect(normalizedPath).to.equal('C:\\path\\to\\folder\\');
    } else {
        expect(normalizedPath).to.equal('/path/to/folder/');
    }
});

test('should normalize empty path', () => {
    const path = '';
    expect(() => normalizePath(path)).to.throw('Path cannot be empty');
});

test('should normalize root path', () => {
    const path = '/';
    const normalizedPath: string = normalizePath(path);

    if (process.platform === 'win32') {
        expect(normalizedPath).to.equal('C:\\');
    } else {
        expect(normalizedPath).to.equal('/');
    }
});

if (process.platform === 'win32') {
    test('should append trailing backslash if path ends with backslash on Windows systems', () => {
        const path = 'C:\\Windows\\';
        const normalizedPath = normalizePath(path);
        expect(normalizedPath).to.equal('C:\\Windows\\');
    });
}
