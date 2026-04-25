import { expect, test } from 'vitest';
import { pdfToPng, VerbosityLevel } from '../src/index.js';

test('should expose the documented root exports from src/index.js', () => {
    expect(pdfToPng).toBeDefined();
    expect(VerbosityLevel).toBeDefined();
});
