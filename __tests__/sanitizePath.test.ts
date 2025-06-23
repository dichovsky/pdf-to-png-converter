import { expect, test } from 'vitest';
import { sanitizePath } from '../src/pdfToPng';

const basePath = '/base/path';

test('should resolve a valid relative path', () => {
    const targetPath = 'subdir/file.png';
    const sanitizedPath = sanitizePath(basePath, targetPath);
    expect(sanitizedPath).toBe('/base/path/subdir/file.png');
});

test('should resolve a valid absolute path within the base path', () => {
    const targetPath = '/base/path/subdir/file.png';
    const sanitizedPath = sanitizePath(basePath, targetPath);
    expect(sanitizedPath).toBe('/base/path/subdir/file.png');
});

test('should throw an error for a path traversal attack', () => {
    const targetPath = '../etc/passwd';
    expect(() => sanitizePath(basePath, targetPath)).toThrow('Invalid path: Path traversal detected.');
});

test('should throw an error for a path outside the base path', () => {
    const targetPath = '/etc/passwd';
    expect(() => sanitizePath(basePath, targetPath)).toThrow('Invalid path: Path traversal detected.');
});

test('should resolve a path with mixed separators', () => {
    const targetPath = 'subdir\\file.png';
    const sanitizedPath = sanitizePath(basePath, targetPath);
    expect(sanitizedPath).toBe('/base/path/subdir/file.png');
});