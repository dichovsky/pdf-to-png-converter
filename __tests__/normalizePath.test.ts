import { expect, test } from 'vitest';
import { normalizePath } from '../src/normalizePath';

test('should normalize path ending with slash', () => {
    const path = '/path/to/folder/';
    const normalizedPath: string = normalizePath(path);
    if (process.platform === 'win32') {
        expect(normalizedPath).to.equal(`${__dirname[0]}:\\path\\to\\folder\\`);
    } else {
        expect(normalizedPath).to.equal('/path/to/folder/');
    }
});

test('should normalize path without ending slash', () => {
    const path = '/path/to/folder';
    const normalizedPath: string = normalizePath(path);
    if (process.platform === 'win32') {
        expect(normalizedPath).to.equal(`${__dirname[0]}:\\path\\to\\folder\\`);
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
        expect(normalizedPath).to.equal(`${__dirname[0]}:\\`);
    } else {
        expect(normalizedPath).to.equal('/');
    }
});

if (process.platform === 'win32') {
    test('should append trailing backslash if path ends with backslash on Windows systems', () => {
        const path = `${__dirname[0]}:\\Windows\\`;
        const normalizedPath = normalizePath(path);
        expect(normalizedPath).to.equal(`${__dirname[0]}:\\Windows\\`);
    });
}

test('should normalize path containing spaces', () => {
    const path = '/path/to/my folder/with spaces';
    const normalizedPath: string = normalizePath(path);
    if (process.platform === 'win32') {
        expect(normalizedPath).to.match(/my folder\\with spaces\\/);
    } else {
        expect(normalizedPath).to.equal('/path/to/my folder/with spaces/');
    }
});

test('should normalize path containing parentheses and special characters', () => {
    const path = '/path/to/folder (1)/output';
    const normalizedPath: string = normalizePath(path);
    if (process.platform === 'win32') {
        expect(normalizedPath).to.match(/folder \(1\)\\output\\/);
    } else {
        expect(normalizedPath).to.equal('/path/to/folder (1)/output/');
    }
});

test('should preserve spaces in path and ensure trailing separator', () => {
    const path = '/my documents/pdf output';
    const normalizedPath: string = normalizePath(path);
    if (process.platform === 'win32') {
        expect(normalizedPath.endsWith('\\')).toBe(true);
    } else {
        expect(normalizedPath).to.equal('/my documents/pdf output/');
        expect(normalizedPath.endsWith('/')).toBe(true);
    }
});
