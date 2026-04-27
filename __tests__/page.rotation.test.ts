import { expect, test } from 'vitest';
import { normalizeRotation } from '../src/pageRenderer.js';

test('should normalize supported PDF rotation values', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(270)).toBe(270);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(360)).toBe(0);
});
