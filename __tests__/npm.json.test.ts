import { describe, expect, test } from 'vitest';
import { parseSingleNpmJsonResult } from '../scripts/npm-json';

describe('parseSingleNpmJsonResult', () => {
    test('accepts the direct JSON value emitted by npm 11', () => {
        expect(parseSingleNpmJsonResult('"4.2.0"')).toBe('4.2.0');
    });

    test('unwraps the one-element array emitted by npm 12', () => {
        expect(parseSingleNpmJsonResult('["4.2.0"]')).toBe('4.2.0');
        expect(parseSingleNpmJsonResult('[{"dist":{"attestations":{"url":"https://example.test"}}}]')).toEqual({
            dist: { attestations: { url: 'https://example.test' } },
        });
    });

    test('normalizes empty output and an empty result array to null', () => {
        expect(parseSingleNpmJsonResult('  ')).toBeNull();
        expect(parseSingleNpmJsonResult('[]')).toBeNull();
    });

    test('rejects an ambiguous multi-result response', () => {
        expect(() => parseSingleNpmJsonResult('["4.1.1", "4.2.0"]')).toThrow('Expected one npm JSON result, received 2');
    });
});
