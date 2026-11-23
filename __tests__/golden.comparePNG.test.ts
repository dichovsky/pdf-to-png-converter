import { createCanvas } from '@napi-rs/canvas';
import { existsSync, mkdirSync, mkdtempSync, promises as fsPromises, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { comparePNG } from './comparePNG';

/**
 * A missing golden PNG must fail its test. Creating it from the render under test would compare the render with
 * itself and pass whatever the renderer does, so the helper creates a missing golden only on request
 * (UPDATE_GOLDENS=1) and never when CI is set. Everything here uses temporary directories; test-data/ is untouched.
 */

const temporaryRoots: string[] = [];

beforeEach(() => {
    // GitHub Actions sets CI=true, so the ambient value must never decide the outcome of a case.
    vi.stubEnv('CI', undefined);
    vi.stubEnv('UPDATE_GOLDENS', undefined);
});

afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of temporaryRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});

/** A solid 8x8 PNG: two different colours differ in every pixel. */
function solidPng(color: string): Buffer {
    const canvas = createCanvas(8, 8);
    const context = canvas.getContext('2d');
    context.fillStyle = color;
    context.fillRect(0, 0, 8, 8);
    return canvas.toBuffer('image/png');
}

/** A golden path in a fresh temporary directory; neither the file nor its folder exists yet. */
function goldenPath(): string {
    const root = mkdtempSync(join(tmpdir(), 'golden-compare-'));
    temporaryRoots.push(root);
    return join(root, 'expected', 'page_1.png');
}

/** Writes a golden at a new path and returns the path. */
function existingGolden(png: Buffer): string {
    const expectedFile = goldenPath();
    mkdirSync(dirname(expectedFile), { recursive: true });
    writeFileSync(expectedFile, png);
    return expectedFile;
}

/** The message comparePNG rejects with; fails the test when it resolves instead. */
async function rejectionMessage(call: Promise<unknown>): Promise<string> {
    const outcome = await call.then(
        () => undefined,
        (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(Error);
    return (outcome as Error).message;
}

test('fails on a missing golden by default, names the file, says how to create it and creates nothing', async () => {
    const expectedFile = goldenPath();

    const message = await rejectionMessage(comparePNG({ actualFile: solidPng('red'), expectedFile }));

    expect(message).toContain(expectedFile);
    expect(message).toContain('UPDATE_GOLDENS=1');
    expect(existsSync(expectedFile)).toBe(false);
});

test.each(['', '0', 'true', 'yes'])('does not create a missing golden when UPDATE_GOLDENS is %j', async (value) => {
    vi.stubEnv('UPDATE_GOLDENS', value);
    const expectedFile = goldenPath();

    const message = await rejectionMessage(comparePNG({ actualFile: solidPng('red'), expectedFile }));

    expect(message).toContain('UPDATE_GOLDENS=1');
    expect(existsSync(expectedFile)).toBe(false);
});

test('creates a missing golden from the actual image, folder included, when UPDATE_GOLDENS=1', async () => {
    vi.stubEnv('UPDATE_GOLDENS', '1');
    const actualFile = solidPng('red');
    const expectedFile = goldenPath();

    await expect(comparePNG({ actualFile, expectedFile })).resolves.toBe(0);

    expect(readFileSync(expectedFile).equals(actualFile)).toBe(true);
});

test('creates a missing golden from an actual image given as a file path when UPDATE_GOLDENS=1', async () => {
    vi.stubEnv('UPDATE_GOLDENS', '1');
    const actual = solidPng('red');
    const actualFile = existingGolden(actual);
    const expectedFile = goldenPath();

    await expect(comparePNG({ actualFile, expectedFile })).resolves.toBe(0);

    expect(readFileSync(expectedFile).equals(actual)).toBe(true);
});

test('never creates a missing golden when CI is set, even with UPDATE_GOLDENS=1', async () => {
    vi.stubEnv('CI', 'true');
    vi.stubEnv('UPDATE_GOLDENS', '1');
    const expectedFile = goldenPath();

    const message = await rejectionMessage(comparePNG({ actualFile: solidPng('red'), expectedFile }));

    expect(message).toContain(expectedFile);
    expect(message).toContain('CI');
    expect(existsSync(expectedFile)).toBe(false);
});

test('compares against an existing golden and never overwrites it, even with UPDATE_GOLDENS=1', async () => {
    vi.stubEnv('UPDATE_GOLDENS', '1');
    const golden = solidPng('blue');
    const expectedFile = existingGolden(golden);

    await expect(comparePNG({ actualFile: golden, expectedFile })).resolves.toBe(0);
    await expect(comparePNG({ actualFile: solidPng('red'), expectedFile })).resolves.toBeGreaterThan(0);

    expect(readFileSync(expectedFile).equals(golden)).toBe(true);
});

test('still compares against an existing golden when CI is set', async () => {
    vi.stubEnv('CI', 'true');
    const golden = solidPng('blue');
    const expectedFile = existingGolden(golden);

    await expect(comparePNG({ actualFile: golden, expectedFile })).resolves.toBe(0);
    await expect(comparePNG({ actualFile: solidPng('red'), expectedFile })).resolves.toBeGreaterThan(0);
});

test('rejects JPEG data with the same pixels as a golden PNG', async () => {
    const canvas = createCanvas(8, 8);
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, 8, 8);
    const expectedFile = existingGolden(canvas.toBuffer('image/png'));
    await expect(comparePNG({ actualFile: canvas.toBuffer('image/jpeg'), expectedFile })).rejects.toThrow(
        'Invalid PNG header in actual image',
    );
});

test('identifies a truncated golden before reading its dimensions', async () => {
    const actualFile = solidPng('white');
    const expectedFile = existingGolden(actualFile.subarray(0, 20));
    await expect(comparePNG({ actualFile, expectedFile })).rejects.toThrow(`Invalid PNG header in ${expectedFile}`);
});

test('rejects different PNG dimensions even when padding would match the extra pixels', async () => {
    const canvas = createCanvas(9, 8);
    const context = canvas.getContext('2d');
    context.fillStyle = 'lime';
    context.fillRect(0, 0, 9, 8);
    const expectedFile = existingGolden(solidPng('lime'));
    await expect(comparePNG({ actualFile: canvas.toBuffer('image/png'), expectedFile })).rejects.toThrow('expected 8x8, got 9x8');
});

test('creates and compares a valid render wider than the comparator default', async () => {
    vi.stubEnv('UPDATE_GOLDENS', '1');
    const actualFile = createCanvas(16_385, 1).toBuffer('image/png');
    const expectedFile = goldenPath();
    await expect(comparePNG({ actualFile, expectedFile })).resolves.toBe(0);
    expect(readFileSync(expectedFile)).toEqual(actualFile);
});

test('invalid PNG data cannot create a golden', async () => {
    vi.stubEnv('UPDATE_GOLDENS', '1');
    const expectedFile = goldenPath();
    await expect(comparePNG({ actualFile: Buffer.from('invalid'), expectedFile })).rejects.toThrow();
    expect(existsSync(expectedFile)).toBe(false);
});

test.each([
    ['rgb(20, 145, 155)', 64],
    ['rgb(80, 125, 105)', 64],
    ['rgb(160, 128, 128)', 64],
    ['rgb(128, 150, 128)', 64],
    ['rgb(129, 128, 128)', 0],
])('counts pixelmatch 8 mismatches for %s against mid-gray', async (color, differences) => {
    const expectedFile = existingGolden(solidPng('rgb(128, 128, 128)'));
    await expect(comparePNG({ actualFile: solidPng(color), expectedFile })).resolves.toBe(differences);
});

test('concurrent creators see a complete golden while another writer is still writing', async () => {
    vi.stubEnv('UPDATE_GOLDENS', '1');
    const expectedFile = goldenPath();
    const actualFile = solidPng('white');
    const writing = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const writeFile = fsPromises.writeFile.bind(fsPromises);
    const write = vi.spyOn(fsPromises, 'writeFile').mockImplementationOnce(async (path, _data, options) => {
        await writeFile(path, actualFile.subarray(0, 8), options);
        writing.resolve();
        await resume.promise;
        await fsPromises.appendFile(path, actualFile.subarray(8));
    });
    const first = comparePNG({ actualFile, expectedFile });
    try {
        await writing.promise;
        await expect(comparePNG({ actualFile, expectedFile })).resolves.toBe(0);
    } finally {
        resume.resolve();
        write.mockRestore();
        await first;
    }
    expect(readFileSync(expectedFile)).toEqual(actualFile);
});
