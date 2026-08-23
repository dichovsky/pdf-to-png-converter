import { expect, test } from 'vitest';
import { pdfToPng, VerbosityLevel } from '../src/index.js';

test('should expose the documented root exports from src/index.js', () => {
    expect(pdfToPng).toBeDefined();
    expect(VerbosityLevel).toEqual({
        0: 'ERRORS',
        1: 'WARNINGS',
        5: 'INFOS',
        ERRORS: 0,
        WARNINGS: 1,
        INFOS: 5,
    });
});
