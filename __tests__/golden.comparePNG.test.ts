import { createCanvas } from '@napi-rs/canvas';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
