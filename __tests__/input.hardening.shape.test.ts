import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { MAX_INPUT_BYTES } from '../src/const';
import { getPdfFileBuffer } from '../src/pdfInput';
import { pdfToPng } from '../src/pdfToPng';

// Input-shape hardening at the getPdfFileBuffer seam: a value that is not a byte container meets
// the same `Unsupported buffer type: <shape>` error as every other bad shape, and does so before
// any work proportional to a size the value merely claims. Reachable from JavaScript callers only,
// hence the casts.

const asInput = (value: unknown): ArrayBufferLike => value as ArrayBufferLike;

// maxInputBytes bounds the length an array-like CLAIMS, not the work of copying it: Uint8Array.from
// performs one property read per claimed element, so a 20-byte JSON body {"length":268435456}
// would block the event loop for seconds. Only genuine Arrays are byte arrays.
test('rejects an object that merely claims a numeric length without reading any of its elements', async () => {
    let elementReads = 0;
    const claimsLength = new Proxy(
        { length: 1000 },
        {
            get(target, key, receiver): unknown {
                if (typeof key === 'string' && /^\d+$/.test(key)) {
                    elementReads += 1;
                }
                return Reflect.get(target, key, receiver);
            },
        },
    );

    await expect(getPdfFileBuffer(asInput(claimsLength), MAX_INPUT_BYTES)).rejects.toThrow('Unsupported buffer type: [object Object]');
    expect(elementReads).toBe(0);
});

test.each<[string, unknown]>([
    ['a plain object with only a length', { length: 2 ** 20 }],
    ['a plain object with indexed bytes', { 0: 37, 1: 80, length: 2 }],
])('rejects %s as an unsupported shape', async (_label, value) => {
    await expect(getPdfFileBuffer(asInput(value), MAX_INPUT_BYTES)).rejects.toThrow('Unsupported buffer type: [object Object]');
});

test('accepts a byte Array created in another realm, which fails instanceof Array', async () => {
    const source = Buffer.from([37, 80, 68, 70, 45]);
    // The `data` field of a Buffer that round-tripped through JSON inside another realm.
    const foreign = runInNewContext('JSON.parse(json).data', { json: JSON.stringify(source) }) as number[];
    expect(foreign instanceof Array).toBe(false);
    expect(Array.isArray(foreign)).toBe(true);

    const result = await getPdfFileBuffer(asInput(foreign), MAX_INPUT_BYTES);

    expect(Buffer.from(result).equals(source)).toBe(true);
});

// null and undefined used to reach `pdfFile.byteLength` and surface as a raw V8 TypeError
// ("Cannot read properties of null (reading 'byteLength')"). Primitives already fell through to the
// unsupported-shape error; they are pinned here so every non-object input stays on one message.
test.each<[string, unknown, string]>([
    ['null', null, '[object Null]'],
    ['undefined', undefined, '[object Undefined]'],
    ['a number', 5, '[object Number]'],
    ['a boolean', true, '[object Boolean]'],
    ['a symbol', Symbol('pdf'), '[object Symbol]'],
    ['a bigint', 10n, '[object BigInt]'],
    ['a function', () => undefined, '[object Function]'],
])('rejects %s with the unsupported-shape error instead of an engine TypeError', async (_label, value, tag) => {
    const rejection: unknown = await getPdfFileBuffer(asInput(value), MAX_INPUT_BYTES).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).not.toBeInstanceOf(TypeError);
    expect((rejection as Error).message).toBe(`Unsupported buffer type: ${tag}`);
});

test('pdfToPng rejects a missing input with the unsupported-shape error', async () => {
    await expect(pdfToPng(undefined as unknown as string)).rejects.toThrow('Unsupported buffer type: [object Undefined]');
});

// `instanceof SharedArrayBuffer` is realm-bound, so a SharedArrayBuffer from node:vm / isolated-vm
// used to be rejected as "Unsupported buffer type: [object SharedArrayBuffer]" while the same
// container from this realm, and a cross-realm view over it, converted.
test('accepts a cross-realm SharedArrayBuffer and copies it into unshared bytes', async () => {
    const source = Uint8Array.from([37, 80, 68, 70, 45]);
    const foreign = runInNewContext('new SharedArrayBuffer(len)', { len: source.byteLength }) as SharedArrayBuffer;
    new Uint8Array(foreign).set(source);
    expect(foreign instanceof SharedArrayBuffer).toBe(false);

    const result = await getPdfFileBuffer(foreign, MAX_INPUT_BYTES);

    expect(Array.from(result)).toEqual(Array.from(source));
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
    // A copy, not a view: later writes to the caller's shared memory must not reach the result.
    new Uint8Array(foreign)[0] = 0;
    expect(result[0]).toBe(source[0]);
});

test('applies maxInputBytes to a cross-realm SharedArrayBuffer', async () => {
    const foreign = runInNewContext('new SharedArrayBuffer(16)') as SharedArrayBuffer;
    await expect(getPdfFileBuffer(foreign, 8)).rejects.toThrow(/exceeds maxInputBytes/);
});

// A detached buffer is a supported shape in a dead state, not an unsupported shape: V8's own error
// names the real cause, which "Unsupported buffer type: [object ArrayBuffer]" would hide.
test.each<[string, () => ArrayBufferLike | Uint8Array]>([
    [
        'an ArrayBuffer',
        () => {
            const buffer = new ArrayBuffer(16);
            buffer.transfer();
            return buffer;
        },
    ],
    [
        'a Uint8Array view',
        () => {
            const buffer = new ArrayBuffer(16);
            const view = new Uint8Array(buffer);
            buffer.transfer();
            return view;
        },
    ],
])('leaves a detached %s to the engine error that names the real cause', async (_label, makeInput) => {
    await expect(getPdfFileBuffer(makeInput(), MAX_INPUT_BYTES)).rejects.toThrow(/detached/);
});
