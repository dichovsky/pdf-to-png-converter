/**
 * Generator for the wasm-decoder regression fixtures (issue #278).
 *
 * pdfjs-dist 6.x decodes CCITT, JBIG2 and JPEG 2000 image data only through the wasm files in its `wasm/` folder,
 * located through the `wasmUrl` document parameter. When that parameter is missing, pdf.js logs a warning (only at
 * verbosity >= 1) and paints the image blank. These fixtures prove the images decode.
 *
 *   npx ts-node scripts/generate-wasm-fixtures.ts                  write test-data/wasm/*.pdf
 *   npx ts-node scripts/generate-wasm-fixtures.ts --check          regenerate in memory, exit 1 if any committed file differs
 *   npx ts-node scripts/generate-wasm-fixtures.ts --self-test      run the encoder/decoder property tests, write nothing
 *   npx ts-node scripts/generate-wasm-fixtures.ts --dir <folder>   use another output folder (default: test-data/wasm)
 *
 * Every file is built by hand from Node built-ins only (no downloads, no third-party scan data, so there is no
 * licensing question). Output is deterministic: no timestamps, no ids, seeded pseudo-random pictures, integer-only
 * geometry maths, and a built-in Flate writer, so the bytes do not depend on the Node.js or zlib version
 * (`zlib.deflateSync` output is not stable across zlib builds). `node:zlib` is used only to inflate, which is
 * exactly specified, to prove the built-in Flate writer correct.
 *
 * PAIRS. Every case is written twice:
 *
 *   <name>.pdf          the picture stored with a wasm-decoded codec (CCITT G3/G4 or JBIG2)
 *   <name>.control.pdf  the same picture, same page geometry, same content-stream operators, stored with FlateDecode
 *                       (for image masks and inline images, the Flate form of the same construct)
 *
 * With a working decoder both files render to byte-identical PNGs. A test should therefore compare the two PNG
 * buffers exactly AND check that the control is not blank (a broken page would render two equal white PNGs):
 *
 *   ccitt-g4            CCITT Group 4 (/K -1), 128x128 checkerboard of 8 px squares, 1:1.
 *   ccitt-g3-1d         CCITT Group 3 one-dimensional (/K 0), 100x77 diagonal stripes (width is not a multiple of 8), 1:1.
 *   ccitt-g4-blackis1   Group 4 with /BlackIs1 true and no /Decode: the decoder emits 1 for black, DeviceGray reads 1 as
 *                       white, so the coded bitmap is the NEGATIVE of the picture. The control holds the picture itself.
 *   jbig2-mmr           JBIG2 embedded stream, page-information segment + immediate generic region coded with MMR, 128x128.
 *   jbig2-arith         JBIG2 generic region, arithmetic (MQ) coding, template 0, 100x70, the path real scanners produce.
 *   ccitt-imagemask     CCITT image mask (/ImageMask true) painted with a blue fill colour. Ink pixels are blue, not black.
 *   ccitt-inline        Inline image (BI ... ID ... EI) with /F /CCF. The control is an inline image with /F /Fl.
 *   ccitt-g4-scaled     96x64 Group 4 image drawn at 2.5x with a fractional offset on a larger page, so pdf.js must scale it.
 *   mixed-pages         ONE 8-page PDF mixing G4, G3, JBIG2 MMR and JBIG2 arithmetic pages (each page has its own image
 *                       object, so no decode is skipped by pdf.js object caching). It exercises the first-load race
 *                       of the wasm decoders under concurrent page rendering and in worker threads. Its control has
 *                       the same 8 pages as Flate.
 *
 * NOT A PAIR:
 *
 *   jpx-flat-gray.pdf   32x32 JPEG 2000 image (JPXDecode, openjpeg.wasm). The codestream is hand-built and carries one
 *                       EMPTY packet, so every wavelet coefficient is zero and a valid decoder outputs the DC level
 *                       shift: a flat mid-gray. It exercises "pdf.js loads openjpeg.wasm and decodes a JPXDecode image",
 *                       not the tier-1 entropy decoder. There is no control file. A test must assert that the PNG is NOT
 *                       all white and that EVERY pixel is gray 128 (R = G = B = 128). Without the fix it is all white.
 *                       Its only validity check is that OpenJPEG itself accepts it.
 *   flate1bit.pdf       128x128 FlateDecode 1-bit image, left half black. A plain control that never touches a wasm file.
 *
 * VALIDATION. Each encoder is checked while the files are built: the encoded bytes are decoded again by an independent
 * decoder (a different algorithm from the encoder) and compared with the source bitmap, and the Flate writer is checked
 * with `zlib.inflateSync`. `--self-test` adds randomized round-trip tests, mode-coverage checks and a determinism check.
 * CAVEAT: the CCITT encoder and decoder share the typed ITU-T T.4 code tables, so a mistyped table entry would
 * round-trip cleanly. The tables were typed twice independently and compared, and the real independent check is pdf.js
 * (jbig2.wasm) decoding the fixtures to exactly the Flate control.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------------------------------------------------

export const FIXTURE_DIRECTORY: string = join(__dirname, '..', 'test-data', 'wasm');

/** One generated file: a name relative to the fixture directory and its exact bytes. */
export interface FixtureFile {
    name: string;
    bytes: Uint8Array;
}

/** What one page of a codec/control pair must render to. Lets a test assert that the control is not blank. */
export interface PageInfo {
    /** PNG size at the default viewport scale of 1. */
    pixelWidth: number;
    pixelHeight: number;
    /** Number of ink (dark or painted) pixels in the source picture. Equals the rendered ink pixel count at scale 1:1. */
    inkPixels: number;
    /** True when the picture is drawn 1:1, so `inkPixels` is exact in the PNG. */
    oneToOne: boolean;
}

export interface PairInfo {
    /** `<name>.pdf` is the codec file and `<name>.control.pdf` the Flate control. */
    name: string;
    pages: PageInfo[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Bytes, bitmaps, pictures
// ---------------------------------------------------------------------------------------------------------------------

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
    let total = 0;
    for (const part of parts) {
        total += part.length;
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}

function latin1(text: string): Uint8Array {
    return Buffer.from(text, 'latin1');
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && Buffer.compare(a, b) === 0;
}

/** A 1-bit picture. `ink` holds one byte per pixel, row-major, 1 = dark ink and 0 = paper. */
interface Bitmap {
    readonly width: number;
    readonly height: number;
    readonly ink: Uint8Array;
}

function makeBitmap(width: number, height: number, isInk: (x: number, y: number) => boolean): Bitmap {
    const ink = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            ink[y * width + x] = isInk(x, y) ? 1 : 0;
        }
    }
    return { width, height, ink };
}

function invertBitmap(bitmap: Bitmap): Bitmap {
    return makeBitmap(bitmap.width, bitmap.height, (x, y) => bitmap.ink[y * bitmap.width + x] === 0);
}

function bitmapsEqual(a: Bitmap, b: Bitmap): boolean {
    return a.width === b.width && a.height === b.height && bytesEqual(a.ink, b.ink);
}

function countInk(bitmap: Bitmap): number {
    let count = 0;
    for (const value of bitmap.ink) {
        count += value;
    }
    return count;
}

/** Small seeded generator (Numerical Recipes LCG). Division by 2^32 is exact, so results are identical everywhere. */
function createRandom(seed: number): () => number {
    let state = seed >>> 0;
    return (): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function checkerboard(width: number, height: number, square: number): Bitmap {
    return makeBitmap(width, height, (x, y) => (Math.floor(x / square) + Math.floor(y / square)) % 2 === 0);
}

function diagonalStripes(width: number, height: number): Bitmap {
    return makeBitmap(width, height, (x, y) => (x + y) % 7 < 3);
}

/** Concentric rectangular rings, each `thickness` pixels wide. */
function nestedFrames(width: number, height: number, thickness: number): Bitmap {
    return makeBitmap(width, height, (x, y) => Math.floor(Math.min(x, y, width - 1 - x, height - 1 - y) / thickness) % 2 === 0);
}

/** Asymmetric picture (border, both diagonals, one block in the upper right) so a flip or transpose changes it. Integer maths only. */
function crossFrame(width: number, height: number): Bitmap {
    const diagonalLimit = 16 * (width * width + height * height);
    return makeBitmap(width, height, (x, y) => {
        const insideBorder = x >= 1 && y >= 1 && x < width - 1 && y < height - 1;
        const onBorder = insideBorder && (x < 6 || y < 6 || x >= width - 6 || y >= height - 6);
        const mainOffset = x * height - y * width;
        const antiOffset = (width - 1 - x) * height - y * width;
        const onMainDiagonal = mainOffset * mainOffset < diagonalLimit;
        const onAntiDiagonal = antiOffset * antiOffset < diagonalLimit;
        const inBlock = x * 10 > width * 7 && x * 10 < width * 9 && y * 10 > height && y * 10 < height * 3;
        return onBorder || onMainDiagonal || onAntiDiagonal || inBlock;
    });
}

/** Text-like rows of horizontal bars separated by blank rows. Produces pass, horizontal and vertical G4 modes. */
function bars(width: number, height: number, seed: number): Bitmap {
    const random = createRandom(seed);
    const bitmap = new Uint8Array(width * height);
    for (let top = 4; top + 6 < height; top += 12) {
        let x = 4 + Math.floor(random() * 8);
        while (x < width - 10) {
            const length = 8 + Math.floor(random() * 30);
            for (let y = top; y < top + 6; y++) {
                for (let column = x; column < Math.min(width - 2, x + length); column++) {
                    bitmap[y * width + column] = 1;
                }
            }
            x += length + 6 + Math.floor(random() * 10);
        }
    }
    return { width, height, ink: bitmap };
}

/** Random alternating runs per row, partly correlated with the previous row. Used by the randomized self-test. */
function randomRuns(width: number, height: number, seed: number): Bitmap {
    const random = createRandom(seed);
    const ink = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        let x = 0;
        let colour = random() < 0.5 ? 1 : 0;
        while (x < width) {
            const length = 1 + Math.floor(random() * random() * 90);
            for (let k = 0; k < length && x < width; k++, x++) {
                ink[y * width + x] = colour;
            }
            colour ^= 1;
        }
        if (y > 0 && random() < 0.5) {
            for (let x2 = 0; x2 < width; x2++) {
                if (random() < 0.9) {
                    ink[y * width + x2] = ink[(y - 1) * width + x2];
                }
            }
        }
    }
    return { width, height, ink };
}

function leftHalfBlack(width: number, height: number): Bitmap {
    return makeBitmap(width, height, (x) => x < width / 2);
}

// ---------------------------------------------------------------------------------------------------------------------
// CCITT: ITU-T T.4 / T.6 code tables (typed twice independently and compared; see the CAVEAT in the header)
// ---------------------------------------------------------------------------------------------------------------------

// prettier-ignore
const WHITE_TERMINATING: readonly string[] = [
    '00110101', '000111', '0111', '1000', '1011', '1100', '1110', '1111', '10011', '10100', '00111', '01000', '001000', '000011',
    '110100', '110101', '101010', '101011', '0100111', '0001100', '0001000', '0010111', '0000011', '0000100', '0101000', '0101011',
    '0010011', '0100100', '0011000', '00000010', '00000011', '00011010', '00011011', '00010010', '00010011', '00010100', '00010101',
    '00010110', '00010111', '00101000', '00101001', '00101010', '00101011', '00101100', '00101101', '00000100', '00000101', '00001010',
    '00001011', '01010010', '01010011', '01010100', '01010101', '00100100', '00100101', '01011000', '01011001', '01011010', '01011011',
    '01001010', '01001011', '00110010', '00110011', '00110100',
];

// prettier-ignore
const BLACK_TERMINATING: readonly string[] = [
    '0000110111', '010', '11', '10', '011', '0011', '0010', '00011', '000101', '000100', '0000100', '0000101', '0000111', '00000100',
    '00000111', '000011000', '0000010111', '0000011000', '0000001000', '00001100111', '00001101000', '00001101100', '00000110111',
    '00000101000', '00000010111', '00000011000', '000011001010', '000011001011', '000011001100', '000011001101', '000001101000',
    '000001101001', '000001101010', '000001101011', '000011010010', '000011010011', '000011010100', '000011010101', '000011010110',
    '000011010111', '000001101100', '000001101101', '000011011010', '000011011011', '000001010100', '000001010101', '000001010110',
    '000001010111', '000001100100', '000001100101', '000001010010', '000001010011', '000000100100', '000000110111', '000000111000',
    '000000100111', '000000101000', '000001011000', '000001011001', '000000101011', '000000101100', '000001011010', '000001100110',
    '000001100111',
];

/** Make-up codes for run lengths 64, 128, ... 1728. */
// prettier-ignore
const WHITE_MAKEUP: readonly string[] = [
    '11011', '10010', '010111', '0110111', '00110110', '00110111', '01100100', '01100101', '01101000', '01100111', '011001100',
    '011001101', '011010010', '011010011', '011010100', '011010101', '011010110', '011010111', '011011000', '011011001', '011011010',
    '011011011', '010011000', '010011001', '010011010', '011000', '010011011',
];

// prettier-ignore
const BLACK_MAKEUP: readonly string[] = [
    '0000001111', '000011001000', '000011001001', '000001011011', '000000110011', '000000110100', '000000110101', '0000001101100',
    '0000001101101', '0000001001010', '0000001001011', '0000001001100', '0000001001101', '0000001110010', '0000001110011',
    '0000001110100', '0000001110101', '0000001110110', '0000001110111', '0000001010010', '0000001010011', '0000001010100',
    '0000001010101', '0000001011010', '0000001011011', '0000001100100', '0000001100101',
];

/** Make-up codes shared by both colours for run lengths 1792, 1856, ... 2560. */
// prettier-ignore
const EXTENDED_MAKEUP: readonly string[] = [
    '00000001000', '00000001100', '00000001101', '000000010010', '000000010011', '000000010100', '000000010101', '000000010110',
    '000000010111', '000000011100', '000000011101', '000000011110', '000000011111',
];

const EOL = '000000000001';
const EOFB = EOL + EOL;

/** Two-dimensional mode codes (T.6). */
const MODE_PASS = '0001';
const MODE_HORIZONTAL = '001';
const VERTICAL_CODES: Readonly<Record<string, string>> = {
    '0': '1',
    '1': '011',
    '2': '000011',
    '3': '0000011',
    '-1': '010',
    '-2': '000010',
    '-3': '0000010',
};

/** Code words for one run: extended make-ups, then one make-up, then the terminating code. */
function runCode(black: boolean, length: number): string {
    let remaining = length;
    let code = '';
    while (remaining >= 2624) {
        code += EXTENDED_MAKEUP[12];
        remaining -= 2560;
    }
    if (remaining >= 64) {
        const makeup = Math.floor(remaining / 64) * 64;
        code += makeup >= 1792 ? EXTENDED_MAKEUP[(makeup - 1792) / 64] : (black ? BLACK_MAKEUP : WHITE_MAKEUP)[makeup / 64 - 1];
        remaining -= makeup;
    }
    return code + (black ? BLACK_TERMINATING : WHITE_TERMINATING)[remaining];
}

function buildRunDecoder(terminating: readonly string[], makeup: readonly string[]): Map<string, number> {
    const decoder = new Map<string, number>();
    terminating.forEach((code, run) => decoder.set(code, run));
    makeup.forEach((code, index) => decoder.set(code, (index + 1) * 64));
    EXTENDED_MAKEUP.forEach((code, index) => decoder.set(code, 1792 + index * 64));
    return decoder;
}

const WHITE_RUN_DECODER = buildRunDecoder(WHITE_TERMINATING, WHITE_MAKEUP);
const BLACK_RUN_DECODER = buildRunDecoder(BLACK_TERMINATING, BLACK_MAKEUP);

/** Table sanity: expected sizes, no duplicate codes, and prefix-freeness (a necessary property of every valid code table). */
function checkCodeTables(): void {
    if (WHITE_TERMINATING.length !== 64 || BLACK_TERMINATING.length !== 64 || WHITE_MAKEUP.length !== 27 || BLACK_MAKEUP.length !== 27) {
        throw new Error('CCITT code tables have the wrong size');
    }
    if (EXTENDED_MAKEUP.length !== 13) {
        throw new Error('CCITT extended make-up table has the wrong size');
    }
    const twoDimensional = [MODE_PASS, MODE_HORIZONTAL, ...Object.values(VERTICAL_CODES), EOL];
    const tables: Array<[string, string[]]> = [
        ['white', [...WHITE_RUN_DECODER.keys(), EOL]],
        ['black', [...BLACK_RUN_DECODER.keys(), EOL]],
        ['two-dimensional', twoDimensional],
    ];
    for (const [name, codes] of tables) {
        if (new Set(codes).size !== codes.length) {
            throw new Error(`${name} code table has duplicate codes`);
        }
        for (const a of codes) {
            for (const b of codes) {
                if (a !== b && b.startsWith(a)) {
                    throw new Error(`${name} code table is not prefix-free: ${a} is a prefix of ${b}`);
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// CCITT encoders (Group 4 / T.6 and Group 3 one-dimensional / T.4)
// ---------------------------------------------------------------------------------------------------------------------

/** Most-significant-bit-first bit sink for code strings made of '0' and '1'. */
class BitWriter {
    private readonly bits: number[] = [];

    public put(code: string): void {
        for (let i = 0; i < code.length; i++) {
            this.bits.push(code.charCodeAt(i) - 48);
        }
    }

    public alignToByte(): void {
        while (this.bits.length % 8 !== 0) {
            this.bits.push(0);
        }
    }

    public toBytes(): Uint8Array {
        const bytes = new Uint8Array(Math.ceil(this.bits.length / 8));
        for (let i = 0; i < this.bits.length; i++) {
            if (this.bits[i] === 1) {
                bytes[i >> 3] |= 0x80 >> (i & 7);
            }
        }
        return bytes;
    }
}

interface G4Stats {
    pass: number;
    horizontal: number;
    vertical: number;
}

/**
 * Group 4 (T.6) encoder written as an explicit pixel scan: a0 is the reference point, a1/a2 are the next changing
 * elements on the coding line and b1/b2 the next changing elements on the reference line. 1 = black.
 */
function encodeG4(bitmap: Bitmap, stats?: G4Stats): Uint8Array {
    const { width, height, ink } = bitmap;
    const writer = new BitWriter();
    const pixel = (y: number, x: number): number => (y < 0 || x < 0 ? 0 : ink[y * width + x]);
    if (stats !== undefined) {
        stats.pass = 0;
        stats.horizontal = 0;
        stats.vertical = 0;
    }
    for (let y = 0; y < height; y++) {
        let a0 = -1;
        let colour = 0;
        while (a0 < width) {
            let a1 = a0 < 0 ? 0 : a0 + 1;
            while (a1 < width && pixel(y, a1) === colour) {
                a1++;
            }
            let b1 = Math.max(a0 + 1, 0);
            while (b1 < width && !(pixel(y - 1, b1) !== pixel(y - 1, b1 - 1) && pixel(y - 1, b1) !== colour)) {
                b1++;
            }
            let b2 = Math.min(b1 + 1, width);
            while (b2 < width && pixel(y - 1, b2) === pixel(y - 1, b1)) {
                b2++;
            }
            if (b2 < a1) {
                writer.put(MODE_PASS);
                a0 = b2;
                if (stats !== undefined) {
                    stats.pass++;
                }
                continue;
            }
            const offset = a1 - b1;
            if (Math.abs(offset) <= 3) {
                writer.put(VERTICAL_CODES[String(offset)]);
                a0 = a1;
                colour ^= 1;
                if (stats !== undefined) {
                    stats.vertical++;
                }
                continue;
            }
            let a2 = Math.min(a1 + 1, width);
            while (a2 < width && pixel(y, a2) !== colour) {
                a2++;
            }
            writer.put(MODE_HORIZONTAL + runCode(colour === 1, a1 - Math.max(a0, 0)) + runCode(colour === 0, a2 - a1));
            a0 = a2;
            if (stats !== undefined) {
                stats.horizontal++;
            }
        }
    }
    writer.put(EOFB);
    writer.alignToByte();
    return writer.toBytes();
}

/** Alternating run lengths of one row, starting with a (possibly empty) white run. */
function rowRuns(bitmap: Bitmap, y: number): number[] {
    const runs: number[] = [];
    let colour = 0;
    let length = 0;
    for (let x = 0; x < bitmap.width; x++) {
        const value = bitmap.ink[y * bitmap.width + x];
        if (value === colour) {
            length++;
        } else {
            runs.push(length);
            colour = value;
            length = 1;
        }
    }
    runs.push(length);
    return runs;
}

/** Group 3 one-dimensional (/K 0): run-length codes only, no EOL, no row alignment, zero padding at the end. */
function encodeG3OneDimensional(bitmap: Bitmap): Uint8Array {
    const writer = new BitWriter();
    for (let y = 0; y < bitmap.height; y++) {
        rowRuns(bitmap, y).forEach((run, index) => writer.put(runCode(index % 2 === 1, run)));
    }
    writer.alignToByte();
    return writer.toBytes();
}

// ---------------------------------------------------------------------------------------------------------------------
// CCITT decoders used only for validation (bit-by-bit code lookup and change-element lists: a different algorithm
// from the encoders above)
// ---------------------------------------------------------------------------------------------------------------------

class BitReader {
    public position = 0;

    constructor(private readonly bytes: Uint8Array) {}

    public readBit(): number {
        if (this.position >= this.bytes.length * 8) {
            throw new Error('bit stream ended unexpectedly');
        }
        const bit = (this.bytes[this.position >> 3] >> (7 - (this.position & 7))) & 1;
        this.position++;
        return bit;
    }

    public peek(count: number): string {
        let text = '';
        for (let i = 0; i < count; i++) {
            const position = this.position + i;
            text += position < this.bytes.length * 8 ? (this.bytes[position >> 3] >> (7 - (position & 7))) & 1 : '-';
        }
        return text;
    }
}

function readRun(reader: BitReader, black: boolean): number {
    const decoder = black ? BLACK_RUN_DECODER : WHITE_RUN_DECODER;
    let total = 0;
    for (;;) {
        let code = '';
        let value: number | undefined;
        while (value === undefined) {
            code += reader.readBit();
            value = decoder.get(code);
            if (value === undefined && code.length > 13) {
                throw new Error(`invalid run code ${code} at bit ${reader.position}`);
            }
        }
        total += value;
        if (value < 64) {
            return total;
        }
    }
}

type Mode = { kind: 'pass' } | { kind: 'horizontal' } | { kind: 'vertical'; offset: number };

function readMode(reader: BitReader): Mode {
    let code = '';
    for (;;) {
        code += reader.readBit();
        if (code === MODE_PASS) {
            return { kind: 'pass' };
        }
        if (code === MODE_HORIZONTAL) {
            return { kind: 'horizontal' };
        }
        for (const [offset, vertical] of Object.entries(VERTICAL_CODES)) {
            if (code === vertical) {
                return { kind: 'vertical', offset: Number(offset) };
            }
        }
        if (code.length > 7) {
            throw new Error(`invalid 2-D mode code ${code} at bit ${reader.position}`);
        }
    }
}

/** Positions where a row changes colour, with white assumed before the first pixel. Even index: becomes black. */
function changingElements(ink: Uint8Array, width: number, y: number): number[] {
    const changes: number[] = [];
    let previous = 0;
    for (let x = 0; x < width; x++) {
        if (ink[y * width + x] !== previous) {
            changes.push(x);
            previous = ink[y * width + x];
        }
    }
    return changes;
}

function paintRow(ink: Uint8Array, width: number, y: number, changes: readonly number[]): void {
    let colour = 0;
    let from = 0;
    for (const end of [...changes.filter((change) => change < width), width]) {
        if (colour === 1) {
            ink.fill(1, y * width + from, y * width + end);
        }
        from = end;
        colour ^= 1;
    }
}

function decodeG4(data: Uint8Array, width: number, height: number): { bitmap: Bitmap; hasEofb: boolean } {
    const reader = new BitReader(data);
    const ink = new Uint8Array(width * height);
    let reference: number[] = [];
    for (let y = 0; y < height; y++) {
        const changes: number[] = [];
        let a0 = -1;
        let colour = 0;
        while (a0 < width) {
            let index = 0;
            while (index < reference.length && !(reference[index] > a0 && (index & 1) === colour)) {
                index++;
            }
            const b1 = index < reference.length ? reference[index] : width;
            const b2 = index + 1 < reference.length ? reference[index + 1] : width;
            const mode = readMode(reader);
            if (mode.kind === 'pass') {
                a0 = b2;
            } else if (mode.kind === 'vertical') {
                const a1 = b1 + mode.offset;
                if (a1 < 0 || a1 > width || (changes.length > 0 && a1 < changes[changes.length - 1])) {
                    throw new Error(`vertical mode out of range in row ${y}`);
                }
                changes.push(a1);
                a0 = a1;
                colour ^= 1;
            } else {
                const first = readRun(reader, colour === 1);
                const second = readRun(reader, colour === 0);
                const start = Math.max(a0, 0);
                changes.push(start + first, start + first + second);
                a0 = start + first + second;
            }
        }
        paintRow(ink, width, y, changes);
        reference = changingElements(ink, width, y);
    }
    const hasEofb = reader.peek(24) === EOFB;
    return { bitmap: { width, height, ink }, hasEofb };
}

function decodeG3OneDimensional(data: Uint8Array, width: number, height: number): Bitmap {
    const reader = new BitReader(data);
    const ink = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        let x = 0;
        let black = false;
        while (x < width) {
            const run = readRun(reader, black);
            if (x + run > width) {
                throw new Error(`run overflows row ${y}`);
            }
            if (black) {
                ink.fill(1, y * width + x, y * width + x + run);
            }
            x += run;
            black = !black;
        }
    }
    return { width, height, ink };
}

// ---------------------------------------------------------------------------------------------------------------------
// JBIG2 (ITU-T T.88) embedded streams: page-information segment + immediate generic region
// ---------------------------------------------------------------------------------------------------------------------

const SEGMENT_PAGE_INFORMATION = 48;
const SEGMENT_IMMEDIATE_GENERIC_REGION = 38;

function uint32(value: number): Uint8Array {
    return Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
}

function readUint32(data: Uint8Array, offset: number): number {
    return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

/** Segment header (number, type flags, no referred-to segments, page association 1, data length) followed by its data. */
function jbig2Segment(segmentNumber: number, type: number, data: Uint8Array): Uint8Array {
    return concatBytes([uint32(segmentNumber), Uint8Array.of(type & 0x3f, 0x00, 0x01), uint32(data.length), data]);
}

function jbig2PageInformation(bitmap: Bitmap): Uint8Array {
    // width, height, x resolution, y resolution (unknown), page flags, striping information: 19 bytes.
    return concatBytes([uint32(bitmap.width), uint32(bitmap.height), uint32(0), uint32(0), Uint8Array.of(0x00, 0x00, 0x00)]);
}

function jbig2RegionInformation(bitmap: Bitmap): Uint8Array {
    // width, height, x, y, combination operator OR: 17 bytes.
    return concatBytes([uint32(bitmap.width), uint32(bitmap.height), uint32(0), uint32(0), Uint8Array.of(0x00)]);
}

/** Generic region coded with MMR (the same T.6 coding as CCITT Group 4; JBIG2 black is 1). */
function jbig2Mmr(bitmap: Bitmap): Uint8Array {
    const region = concatBytes([jbig2RegionInformation(bitmap), Uint8Array.of(0x01), encodeG4(bitmap)]);
    return concatBytes([
        jbig2Segment(0, SEGMENT_PAGE_INFORMATION, jbig2PageInformation(bitmap)),
        jbig2Segment(1, SEGMENT_IMMEDIATE_GENERIC_REGION, region),
    ]);
}

// MQ arithmetic coder (T.88 Annex E, the same coder as JPEG 2000). Rows: Qe, next state on MPS, next state on LPS, switch MPS.
// prettier-ignore
const QE_TABLE: ReadonlyArray<readonly [number, number, number, number]> = [
    [0x5601, 1, 1, 1], [0x3401, 2, 6, 0], [0x1801, 3, 9, 0], [0x0ac1, 4, 12, 0], [0x0521, 5, 29, 0], [0x0221, 38, 33, 0],
    [0x5601, 7, 6, 1], [0x5401, 8, 14, 0], [0x4801, 9, 14, 0], [0x3801, 10, 14, 0], [0x3001, 11, 17, 0], [0x2401, 12, 18, 0],
    [0x1c01, 13, 20, 0], [0x1601, 29, 21, 0], [0x5601, 15, 14, 1], [0x5401, 16, 14, 0], [0x5101, 17, 15, 0], [0x4801, 18, 16, 0],
    [0x3801, 19, 17, 0], [0x3401, 20, 18, 0], [0x3001, 21, 19, 0], [0x2801, 22, 19, 0], [0x2401, 23, 20, 0], [0x2201, 24, 21, 0],
    [0x1c01, 25, 22, 0], [0x1801, 26, 23, 0], [0x1601, 27, 24, 0], [0x1401, 28, 25, 0], [0x1201, 29, 26, 0], [0x1101, 30, 27, 0],
    [0x0ac1, 31, 28, 0], [0x09c1, 32, 29, 0], [0x08a1, 33, 30, 0], [0x0521, 34, 31, 0], [0x0441, 35, 32, 0], [0x02a1, 36, 33, 0],
    [0x0221, 37, 34, 0], [0x0141, 38, 35, 0], [0x0111, 39, 36, 0], [0x0085, 40, 37, 0], [0x0049, 41, 38, 0], [0x0025, 42, 39, 0],
    [0x0015, 43, 40, 0], [0x0009, 44, 41, 0], [0x0005, 45, 42, 0], [0x0001, 45, 43, 0], [0x5601, 46, 46, 0],
];

const CONTEXT_COUNT = 1 << 16;

class MqEncoder {
    private a = 0x8000;
    private c = 0;
    private ct = 12;
    private bp = -1;
    private readonly output: number[] = [];
    private readonly state = new Uint8Array(CONTEXT_COUNT);
    private readonly mps = new Uint8Array(CONTEXT_COUNT);

    public encode(context: number, bit: number): void {
        const row = QE_TABLE[this.state[context]];
        const qe = row[0];
        this.a -= qe;
        if (bit === this.mps[context]) {
            if ((this.a & 0x8000) === 0) {
                if (this.a < qe) {
                    this.a = qe;
                } else {
                    this.c += qe;
                }
                this.state[context] = row[1];
                this.renormalize();
            } else {
                this.c += qe;
            }
        } else {
            if (this.a < qe) {
                this.c += qe;
            } else {
                this.a = qe;
            }
            if (row[3] === 1) {
                this.mps[context] ^= 1;
            }
            this.state[context] = row[2];
            this.renormalize();
        }
    }

    /** Terminates the code (SETBITS + two byte-outs) and appends the 0xFF 0xAC marker JBIG2 expects. */
    public flush(): Uint8Array {
        const temporary = this.c + this.a;
        this.c = this.c | 0xffff;
        if (this.c >= temporary) {
            this.c -= 0x8000;
        }
        this.c *= 2 ** this.ct;
        this.byteOut();
        this.c *= 2 ** this.ct;
        this.byteOut();
        if (this.bp >= 0 && this.output[this.bp] === 0xff) {
            this.output.length = this.bp;
        }
        return Uint8Array.from([...this.output, 0xff, 0xac]);
    }

    private renormalize(): void {
        do {
            this.a = (this.a << 1) & 0xffff;
            this.c *= 2;
            this.ct--;
            if (this.ct === 0) {
                this.byteOut();
            }
        } while ((this.a & 0x8000) === 0);
    }

    private byteOut(): void {
        if (this.bp >= 0 && this.output[this.bp] === 0xff) {
            this.emit(20, 0xfffff, 7);
            return;
        }
        if (this.c >= 0x8000000 && this.bp >= 0) {
            this.output[this.bp]++;
            if (this.output[this.bp] === 0xff) {
                this.c &= 0x7ffffff;
                this.emit(20, 0xfffff, 7);
                return;
            }
        }
        this.emit(19, 0x7ffff, 8);
    }

    private emit(shift: number, mask: number, bitsUntilNextByte: number): void {
        this.bp++;
        this.output[this.bp] = (this.c >>> shift) & 0xff;
        this.c &= mask;
        this.ct = bitsUntilNextByte;
    }
}

/** MQ decoder in the software convention (same arithmetic as pdf.js); used only to validate the encoder. */
class MqDecoder {
    private position = 0;
    private chigh: number;
    private clow = 0;
    private ct = 0;
    private a = 0x8000;
    private readonly state = new Uint8Array(CONTEXT_COUNT);
    private readonly mps = new Uint8Array(CONTEXT_COUNT);

    constructor(private readonly data: Uint8Array) {
        this.chigh = data[0];
        this.byteIn();
        this.chigh = ((this.chigh << 7) & 0xffff) | ((this.clow >> 9) & 0x7f);
        this.clow = (this.clow << 7) & 0xffff;
        this.ct -= 7;
    }

    public decode(context: number): number {
        const row = QE_TABLE[this.state[context]];
        const qe = row[0];
        let mps = this.mps[context];
        let a = this.a - qe;
        let bit: number;
        let next: number;
        if (this.chigh < qe) {
            if (a < qe) {
                a = qe;
                bit = mps;
                next = row[1];
            } else {
                a = qe;
                bit = 1 ^ mps;
                if (row[3] === 1) {
                    mps = bit;
                }
                next = row[2];
            }
        } else {
            this.chigh -= qe;
            if ((a & 0x8000) !== 0) {
                this.a = a;
                return mps;
            }
            if (a < qe) {
                bit = 1 ^ mps;
                if (row[3] === 1) {
                    mps = bit;
                }
                next = row[2];
            } else {
                bit = mps;
                next = row[1];
            }
        }
        do {
            if (this.ct === 0) {
                this.byteIn();
            }
            a <<= 1;
            this.chigh = ((this.chigh << 1) & 0xffff) | ((this.clow >> 15) & 1);
            this.clow = (this.clow << 1) & 0xffff;
            this.ct--;
        } while ((a & 0x8000) === 0);
        this.a = a;
        this.state[context] = next;
        this.mps[context] = mps;
        return bit;
    }

    private byteIn(): void {
        if (this.data[this.position] === 0xff) {
            if (this.data[this.position + 1] > 0x8f) {
                this.clow += 0xff00;
                this.ct = 8;
            } else {
                this.position++;
                this.clow += this.data[this.position] << 9;
                this.ct = 7;
            }
        } else {
            this.position++;
            this.clow += this.position < this.data.length ? this.data[this.position] << 8 : 0xff00;
            this.ct = 8;
        }
        if (this.clow > 0xffff) {
            this.chigh += this.clow >> 16;
            this.clow &= 0xffff;
        }
    }
}

/**
 * Template 0 context (16 pixels, T.88 figure 3) with the nominal adaptive-template pixels A1 (3,-1), A2 (-3,-1),
 * A3 (2,-2), A4 (-2,-2). Any fixed bijection of the 16 pixels to a context number codes identically, so the bit order
 * here only has to be consistent between encoder and decoder. Pixels outside the region read as 0.
 */
function genericContext(ink: Uint8Array, width: number, x: number, y: number): number {
    const at = (dx: number, dy: number): number => {
        const column = x + dx;
        const row = y + dy;
        return column < 0 || column >= width || row < 0 ? 0 : ink[row * width + column];
    };
    // prettier-ignore
    const neighbours: ReadonlyArray<readonly [number, number]> = [
        [-1, 0], [-2, 0], [-3, 0], [-4, 0],
        [3, -1], [2, -1], [1, -1], [0, -1], [-1, -1], [-2, -1], [-3, -1],
        [2, -2], [1, -2], [0, -2], [-1, -2], [-2, -2],
    ];
    let context = 0;
    for (const [dx, dy] of neighbours) {
        context = (context << 1) | at(dx, dy);
    }
    return context;
}

/** Nominal adaptive-template pixel offsets as signed bytes: (3,-1) (-3,-1) (2,-2) (-2,-2). */
const NOMINAL_AT_PIXELS: readonly number[] = [3, 0xff, 0xfd, 0xff, 2, 0xfe, 0xfe, 0xfe];

/** Generic region coded arithmetically: template 0, typical prediction off, nominal AT pixels. */
function jbig2Arithmetic(bitmap: Bitmap): Uint8Array {
    const encoder = new MqEncoder();
    for (let y = 0; y < bitmap.height; y++) {
        for (let x = 0; x < bitmap.width; x++) {
            encoder.encode(genericContext(bitmap.ink, bitmap.width, x, y), bitmap.ink[y * bitmap.width + x]);
        }
    }
    const region = concatBytes([jbig2RegionInformation(bitmap), Uint8Array.of(0x00), Uint8Array.from(NOMINAL_AT_PIXELS), encoder.flush()]);
    return concatBytes([
        jbig2Segment(0, SEGMENT_PAGE_INFORMATION, jbig2PageInformation(bitmap)),
        jbig2Segment(1, SEGMENT_IMMEDIATE_GENERIC_REGION, region),
    ]);
}

interface Jbig2Segment {
    number: number;
    type: number;
    data: Uint8Array;
}

/** Independent parser: walks the segment headers byte by byte (no referred-to segments, one-byte page association). */
function parseJbig2Segments(stream: Uint8Array): Jbig2Segment[] {
    const segments: Jbig2Segment[] = [];
    let position = 0;
    while (position < stream.length) {
        const number = readUint32(stream, position);
        const flags = stream[position + 4];
        if ((flags & 0x40) !== 0 || stream[position + 5] >> 5 !== 0) {
            throw new Error('unexpected JBIG2 segment header form');
        }
        const length = readUint32(stream, position + 7);
        const data = stream.subarray(position + 11, position + 11 + length);
        if (data.length !== length) {
            throw new Error('JBIG2 segment data is truncated');
        }
        segments.push({ number, type: flags & 0x3f, data });
        position += 11 + length;
    }
    return segments;
}

/** Decodes the page-information + generic-region stream written above back into a bitmap. */
function decodeJbig2(stream: Uint8Array): Bitmap {
    const segments = parseJbig2Segments(stream);
    const page = segments.find((segment) => segment.type === SEGMENT_PAGE_INFORMATION);
    const region = segments.find((segment) => segment.type === SEGMENT_IMMEDIATE_GENERIC_REGION);
    if (page === undefined || region === undefined || segments.length !== 2) {
        throw new Error('JBIG2 stream must hold exactly a page-information and a generic-region segment');
    }
    const width = readUint32(page.data, 0);
    const height = readUint32(page.data, 4);
    if (page.data.length !== 19 || readUint32(region.data, 0) !== width || readUint32(region.data, 4) !== height) {
        throw new Error('JBIG2 page and region sizes disagree');
    }
    if (readUint32(region.data, 8) !== 0 || readUint32(region.data, 12) !== 0 || region.data[16] !== 0) {
        throw new Error('JBIG2 region must sit at the origin with the OR combination operator');
    }
    const flags = region.data[17];
    if ((flags & 1) === 1) {
        return decodeG4(region.data.subarray(18), width, height).bitmap;
    }
    if (flags !== 0x00 || !bytesEqual(region.data.subarray(18, 26), Uint8Array.from(NOMINAL_AT_PIXELS))) {
        throw new Error('JBIG2 arithmetic region must use template 0, no typical prediction, nominal AT pixels');
    }
    const decoder = new MqDecoder(region.data.subarray(26));
    const ink = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            ink[y * width + x] = decoder.decode(genericContext(ink, width, x, y));
        }
    }
    return { width, height, ink };
}

// ---------------------------------------------------------------------------------------------------------------------
// Flate: built-in fixed-Huffman deflate (greedy LZ77, nearest-longest match) so the bytes never depend on the zlib build
// ---------------------------------------------------------------------------------------------------------------------

// prettier-ignore
const LENGTH_BASE: readonly number[] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
];
// prettier-ignore
const LENGTH_EXTRA_BITS: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
// prettier-ignore
const DISTANCE_BASE: readonly number[] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
 ];
// prettier-ignore
const DISTANCE_EXTRA_BITS: readonly number[] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];

const DEFLATE_WINDOW = 32768;
const DEFLATE_MAX_MATCH = 258;
const DEFLATE_END_OF_BLOCK = 256;

/** Deflate packs data bits least-significant first and Huffman codes most-significant first. */
class DeflateBitWriter {
    private readonly bytes: number[] = [];
    private accumulator = 0;
    private count = 0;

    public writeBits(value: number, bits: number): void {
        for (let i = 0; i < bits; i++) {
            this.accumulator |= ((value >> i) & 1) << this.count;
            this.count++;
            if (this.count === 8) {
                this.bytes.push(this.accumulator);
                this.accumulator = 0;
                this.count = 0;
            }
        }
    }

    public writeCode(code: number, bits: number): void {
        for (let i = bits - 1; i >= 0; i--) {
            this.writeBits((code >> i) & 1, 1);
        }
    }

    public finish(): number[] {
        if (this.count > 0) {
            this.bytes.push(this.accumulator);
        }
        return this.bytes;
    }
}

/** Fixed Huffman code (RFC 1951 3.2.6) for a literal/length symbol. */
function writeLiteralOrLengthSymbol(writer: DeflateBitWriter, symbol: number): void {
    if (symbol <= 143) {
        writer.writeCode(0x30 + symbol, 8);
    } else if (symbol <= 255) {
        writer.writeCode(0x190 + symbol - 144, 9);
    } else if (symbol <= 279) {
        writer.writeCode(symbol - 256, 7);
    } else {
        writer.writeCode(0xc0 + symbol - 280, 8);
    }
}

function largestIndexAtMost(table: readonly number[], value: number): number {
    let index = table.length - 1;
    while (table[index] > value) {
        index--;
    }
    return index;
}

function writeMatch(writer: DeflateBitWriter, length: number, distance: number): void {
    const lengthIndex = largestIndexAtMost(LENGTH_BASE, length);
    writeLiteralOrLengthSymbol(writer, 257 + lengthIndex);
    writer.writeBits(length - LENGTH_BASE[lengthIndex], LENGTH_EXTRA_BITS[lengthIndex]);
    const distanceIndex = largestIndexAtMost(DISTANCE_BASE, distance);
    writer.writeCode(distanceIndex, 5);
    writer.writeBits(distance - DISTANCE_BASE[distanceIndex], DISTANCE_EXTRA_BITS[distanceIndex]);
}

/** Raw deflate: one final fixed-Huffman block. Candidates are scanned nearest first and replaced only by a strictly longer match. */
function deflateRaw(data: Uint8Array): number[] {
    const writer = new DeflateBitWriter();
    writer.writeBits(1, 1); // BFINAL
    writer.writeBits(1, 2); // BTYPE = fixed Huffman
    let position = 0;
    while (position < data.length) {
        let bestLength = 0;
        let bestDistance = 0;
        const limit = Math.min(DEFLATE_MAX_MATCH, data.length - position);
        for (let candidate = position - 1; candidate >= Math.max(0, position - DEFLATE_WINDOW); candidate--) {
            if (data[candidate] !== data[position]) {
                continue;
            }
            let length = 1;
            while (length < limit && data[candidate + length] === data[position + length]) {
                length++;
            }
            if (length > bestLength) {
                bestLength = length;
                bestDistance = position - candidate;
            }
        }
        if (bestLength >= 3) {
            writeMatch(writer, bestLength, bestDistance);
            position += bestLength;
        } else {
            writeLiteralOrLengthSymbol(writer, data[position]);
            position++;
        }
    }
    writeLiteralOrLengthSymbol(writer, DEFLATE_END_OF_BLOCK);
    return writer.finish();
}

function adler32(data: Uint8Array): number {
    let a = 1;
    let b = 0;
    for (const value of data) {
        a = (a + value) % 65521;
        b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
}

/** zlib stream (RFC 1950): header 0x78 0x01, fixed-Huffman deflate, Adler-32. Verified against `zlib.inflateSync`. */
function zlibCompress(data: Uint8Array): Uint8Array {
    const stream = concatBytes([Uint8Array.of(0x78, 0x01), Uint8Array.from(deflateRaw(data)), uint32(adler32(data))]);
    if (!bytesEqual(inflateSync(stream), data)) {
        throw new Error('built-in Flate writer failed its inflate round trip');
    }
    return stream;
}

/** Packs a bitmap as DeviceGray 1 bpc rows (row padded to whole bytes): ink = 0 (black), paper = 1 (white). */
function packGrayRows(bitmap: Bitmap): Uint8Array {
    const rowBytes = Math.ceil(bitmap.width / 8);
    const packed = new Uint8Array(rowBytes * bitmap.height).fill(0xff);
    for (let y = 0; y < bitmap.height; y++) {
        for (let x = 0; x < bitmap.width; x++) {
            if (bitmap.ink[y * bitmap.width + x] === 1) {
                packed[y * rowBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
            }
        }
    }
    return packed;
}

// ---------------------------------------------------------------------------------------------------------------------
// PDF writer
// ---------------------------------------------------------------------------------------------------------------------

interface PdfImage {
    /** Image dictionary entries without /Length. */
    dictionary: string;
    data: Uint8Array;
}

interface PdfPage {
    width: number;
    height: number;
    content: Uint8Array;
    image?: PdfImage;
}

function pdfStream(dictionary: string, data: Uint8Array): Uint8Array {
    return concatBytes([latin1(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), data, latin1('\nendstream')]);
}

/** Minimal PDF 1.5 file with a classic xref table. Objects: 1 catalog, 2 page tree, then page, content[, image] per page. */
function buildPdf(pages: readonly PdfPage[]): Uint8Array {
    const objects: Uint8Array[] = [];
    const pageIds: number[] = [];
    const nextId = (): number => objects.length + 3; // ids 1 and 2 are the catalog and the page tree
    for (const page of pages) {
        const pageId = nextId();
        const contentId = pageId + 1;
        const imageId = pageId + 2;
        pageIds.push(pageId);
        const resources = page.image === undefined ? '' : ` /Resources << /XObject << /Im0 ${imageId} 0 R >> >>`;
        objects.push(
            latin1(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Contents ${contentId} 0 R${resources} >>`),
            pdfStream('', page.content),
        );
        if (page.image !== undefined) {
            objects.push(pdfStream(`/Type /XObject /Subtype /Image ${page.image.dictionary}`, page.image.data));
        }
    }
    const all: Uint8Array[] = [
        latin1('<< /Type /Catalog /Pages 2 0 R >>'),
        latin1(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`),
        ...objects,
    ];
    const chunks: Uint8Array[] = [latin1('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n')];
    const offsets: number[] = [];
    let position = chunks[0].length;
    all.forEach((body, index) => {
        const head = latin1(`${index + 1} 0 obj\n`);
        const tail = latin1('\nendobj\n');
        offsets.push(position);
        chunks.push(head, body, tail);
        position += head.length + body.length + tail.length;
    });
    let xref = `xref\n0 ${all.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
        xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    xref += `trailer\n<< /Size ${all.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`;
    chunks.push(latin1(xref));
    return concatBytes(chunks);
}

// ---------------------------------------------------------------------------------------------------------------------
// Scenes: one picture, one page, stored with a codec or as the Flate control
// ---------------------------------------------------------------------------------------------------------------------

type CodecKind = 'g4' | 'g3' | 'jbig2-mmr' | 'jbig2-arith';
type Paint = 'image' | 'mask' | 'inline';

interface Scene {
    /** The picture that must appear on the page: 1 = ink. */
    picture: Bitmap;
    codec: CodecKind;
    /** Group 3/4 /BlackIs1 true: the coded bitmap is the negative of the picture. */
    blackIs1?: boolean;
    paint: Paint;
    page: { width: number; height: number };
    /** Where the image is painted, in points. Defaults to the whole page. */
    placement?: { x: number; y: number; width: number; height: number };
    /** Colour operators before painting, for image masks. */
    fill?: string;
}

interface EncodedImage {
    filter: 'CCITTFaxDecode' | 'JBIG2Decode' | 'FlateDecode';
    /** Contents of /DecodeParms. */
    parameters?: string;
    data: Uint8Array;
}

function expectBitmap(actual: Bitmap, expected: Bitmap, what: string): void {
    if (!bitmapsEqual(actual, expected)) {
        throw new Error(`${what} did not decode back to the source bitmap`);
    }
}

/** Encodes the picture with the scene's codec and proves, with an independent decoder, that the bytes decode back. */
function encodeCodecImage(scene: Scene): EncodedImage {
    const { picture } = scene;
    const { width, height } = picture;
    const coded = scene.blackIs1 === true ? invertBitmap(picture) : picture;
    switch (scene.codec) {
        case 'g4': {
            const data = encodeG4(coded);
            const decoded = decodeG4(data, width, height);
            expectBitmap(decoded.bitmap, coded, 'Group 4 stream');
            if (!decoded.hasEofb) {
                throw new Error('Group 4 stream lacks its EOFB');
            }
            const blackIs1 = scene.blackIs1 === true ? ' /BlackIs1 true' : '';
            return { filter: 'CCITTFaxDecode', parameters: `/K -1 /Columns ${width} /Rows ${height}${blackIs1}`, data };
        }
        case 'g3': {
            const data = encodeG3OneDimensional(coded);
            expectBitmap(decodeG3OneDimensional(data, width, height), coded, 'Group 3 stream');
            return { filter: 'CCITTFaxDecode', parameters: `/K 0 /Columns ${width} /Rows ${height}`, data };
        }
        case 'jbig2-mmr': {
            const data = jbig2Mmr(coded);
            expectBitmap(decodeJbig2(data), coded, 'JBIG2 MMR stream');
            return { filter: 'JBIG2Decode', data };
        }
        case 'jbig2-arith': {
            const data = jbig2Arithmetic(coded);
            expectBitmap(decodeJbig2(data), coded, 'JBIG2 arithmetic stream');
            return { filter: 'JBIG2Decode', data };
        }
    }
}

function encodeControlImage(scene: Scene): EncodedImage {
    return { filter: 'FlateDecode', data: zlibCompress(packGrayRows(scene.picture)) };
}

const INLINE_FILTER_NAMES: Readonly<Record<string, string>> = { CCITTFaxDecode: 'CCF', FlateDecode: 'Fl' };

function placementOf(scene: Scene): { x: number; y: number; width: number; height: number } {
    return scene.placement ?? { x: 0, y: 0, width: scene.page.width, height: scene.page.height };
}

/** The only difference between the codec and the control page is the image filter; geometry and operators are shared. */
function scenePage(scene: Scene, image: EncodedImage): PdfPage {
    const { width, height } = scene.picture;
    const { x, y, width: drawWidth, height: drawHeight } = placementOf(scene);
    const matrix = `q ${drawWidth} 0 0 ${drawHeight} ${x} ${y} cm`;
    const parameters = image.parameters === undefined ? '' : ` /DecodeParms << ${image.parameters} >>`;
    const page = { width: scene.page.width, height: scene.page.height };
    if (scene.paint === 'inline') {
        const filterName = INLINE_FILTER_NAMES[image.filter];
        if (filterName === undefined) {
            throw new Error(`${image.filter} cannot be used for an inline image`);
        }
        const decodeParms = image.parameters === undefined ? '' : ` /DP << ${image.parameters} >>`;
        const head = `${matrix}\nBI /W ${width} /H ${height} /BPC 1 /CS /G /F /${filterName}${decodeParms}\nID `;
        return { ...page, content: concatBytes([latin1(head), image.data, latin1('\nEI\nQ')]) };
    }
    const colourSpace = scene.paint === 'mask' ? '/ImageMask true' : '/ColorSpace /DeviceGray';
    const dictionary = `/Width ${width} /Height ${height} ${colourSpace} /BitsPerComponent 1 /Filter /${image.filter}${parameters}`;
    const fill = scene.fill === undefined ? '' : `${scene.fill}\n`;
    return { ...page, content: latin1(`${fill}${matrix} /Im0 Do Q`), image: { dictionary, data: image.data } };
}

interface BuiltPair {
    codec: Uint8Array;
    control: Uint8Array;
    info: PairInfo;
}

function pageInfoOf(scene: Scene): PageInfo {
    const placement = placementOf(scene);
    return {
        pixelWidth: scene.page.width,
        pixelHeight: scene.page.height,
        inkPixels: countInk(scene.picture),
        oneToOne: placement.width === scene.picture.width && placement.height === scene.picture.height,
    };
}

function buildPair(name: string, scenes: readonly Scene[]): BuiltPair {
    return {
        codec: buildPdf(scenes.map((scene) => scenePage(scene, encodeCodecImage(scene)))),
        control: buildPdf(scenes.map((scene) => scenePage(scene, encodeControlImage(scene)))),
        info: { name, pages: scenes.map(pageInfoOf) },
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// The fixtures
// ---------------------------------------------------------------------------------------------------------------------

function wholePage(picture: Bitmap): { width: number; height: number } {
    return { width: picture.width, height: picture.height };
}

function buildPairs(): BuiltPair[] {
    const checker = checkerboard(128, 128, 8);
    const stripes = diagonalStripes(100, 77);
    const negativeSource = crossFrame(96, 64);
    const mmrPicture = crossFrame(128, 128);
    const arithmeticPicture = bars(100, 70, 21);
    const maskPicture = bars(96, 64, 33);
    const inlinePicture = crossFrame(64, 40);
    const scaledPicture = bars(96, 64, 5);

    const mixed: Scene[] = [
        { picture: crossFrame(100, 80), codec: 'g4', paint: 'image', page: { width: 100, height: 80 } },
        { picture: bars(100, 80, 3), codec: 'jbig2-mmr', paint: 'image', page: { width: 100, height: 80 } },
        { picture: nestedFrames(100, 80, 6), codec: 'g3', paint: 'image', page: { width: 100, height: 80 } },
        { picture: bars(100, 80, 8), codec: 'jbig2-arith', paint: 'image', page: { width: 100, height: 80 } },
        { picture: bars(100, 80, 5), codec: 'g4', paint: 'image', page: { width: 200, height: 160 } },
        { picture: crossFrame(100, 80), codec: 'jbig2-mmr', paint: 'image', page: { width: 100, height: 80 } },
        { picture: bars(100, 80, 13), codec: 'g3', paint: 'image', page: { width: 100, height: 80 } },
        { picture: nestedFrames(100, 80, 5), codec: 'jbig2-arith', paint: 'image', page: { width: 100, height: 80 } },
    ];

    return [
        buildPair('ccitt-g4', [{ picture: checker, codec: 'g4', paint: 'image', page: wholePage(checker) }]),
        buildPair('ccitt-g3-1d', [{ picture: stripes, codec: 'g3', paint: 'image', page: wholePage(stripes) }]),
        buildPair('ccitt-g4-blackis1', [
            { picture: negativeSource, codec: 'g4', blackIs1: true, paint: 'image', page: wholePage(negativeSource) },
        ]),
        buildPair('jbig2-mmr', [{ picture: mmrPicture, codec: 'jbig2-mmr', paint: 'image', page: wholePage(mmrPicture) }]),
        buildPair('jbig2-arith', [
            { picture: arithmeticPicture, codec: 'jbig2-arith', paint: 'image', page: wholePage(arithmeticPicture) },
        ]),
        buildPair('ccitt-imagemask', [
            { picture: maskPicture, codec: 'g4', paint: 'mask', fill: '0.1 0.3 0.9 rg', page: wholePage(maskPicture) },
        ]),
        buildPair('ccitt-inline', [{ picture: inlinePicture, codec: 'g4', paint: 'inline', page: wholePage(inlinePicture) }]),
        buildPair('ccitt-g4-scaled', [
            {
                picture: scaledPicture,
                codec: 'g4',
                paint: 'image',
                page: { width: 260, height: 180 },
                placement: { x: 12.5, y: 10, width: 240, height: 160 },
            },
        ]),
        buildPair('mixed-pages', mixed),
    ];
}

/** A 32x32 JPEG 2000 codestream with one empty packet: every code-block is "not included", so the image is flat gray 128. */
function jpxFlatGrayCodestream(width: number, height: number): Uint8Array {
    const uint16 = (value: number): Uint8Array => Uint8Array.of((value >> 8) & 255, value & 255);
    const startOfCodestream = Uint8Array.of(0xff, 0x4f);
    const size = concatBytes([
        Uint8Array.of(0xff, 0x51),
        uint16(41),
        uint16(0),
        uint32(width),
        uint32(height),
        uint32(0),
        uint32(0),
        uint32(width),
        uint32(height),
        uint32(0),
        uint32(0),
        uint16(1),
        Uint8Array.of(7, 1, 1), // one component: 8 bits unsigned, no subsampling
    ]);
    const codingStyle = concatBytes([
        Uint8Array.of(0xff, 0x52),
        uint16(12),
        Uint8Array.of(0x00, 0x00), // default precincts, LRCP progression
        uint16(1), // one quality layer
        Uint8Array.of(0x00, 0x00, 0x04, 0x04, 0x00, 0x01), // no MCT, 0 decomposition levels, 64x64 code-blocks, reversible 5-3 wavelet
    ]);
    const quantization = Uint8Array.of(0xff, 0x5c, 0x00, 0x04, 0x40, 0x40);
    const packet = Uint8Array.of(0x00); // empty packet header
    const tilePart = concatBytes([
        Uint8Array.of(0xff, 0x90),
        uint16(10),
        uint16(0),
        uint32(12 + 2 + packet.length),
        Uint8Array.of(0, 1),
        Uint8Array.of(0xff, 0x93),
        packet,
    ]);
    return concatBytes([startOfCodestream, size, codingStyle, quantization, tilePart, Uint8Array.of(0xff, 0xd9)]);
}

function buildJpxFlatGray(): Uint8Array {
    const size = 32;
    const dictionary = `/Width ${size} /Height ${size} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /JPXDecode`;
    return buildPdf([
        {
            width: size,
            height: size,
            content: latin1(`q ${size} 0 0 ${size} 0 0 cm /Im0 Do Q`),
            image: { dictionary, data: jpxFlatGrayCodestream(size, size) },
        },
    ]);
}

function buildFlate1Bit(): Uint8Array {
    const picture = leftHalfBlack(128, 128);
    const scene: Scene = { picture, codec: 'g4', paint: 'image', page: wholePage(picture) };
    return buildPdf([scenePage(scene, encodeControlImage(scene))]);
}

const MAX_SINGLE_PAGE_PDF_BYTES = 2048;
const MAX_MIXED_PAGES_PDF_BYTES = 12288;

interface BuiltFixtures {
    files: FixtureFile[];
    pairs: PairInfo[];
}

function buildAll(): BuiltFixtures {
    const files: FixtureFile[] = [];
    const pairs: PairInfo[] = [];
    for (const pair of buildPairs()) {
        files.push({ name: `${pair.info.name}.pdf`, bytes: pair.codec }, { name: `${pair.info.name}.control.pdf`, bytes: pair.control });
        pairs.push(pair.info);
    }
    files.push({ name: 'jpx-flat-gray.pdf', bytes: buildJpxFlatGray() }, { name: 'flate1bit.pdf', bytes: buildFlate1Bit() });
    for (const file of files) {
        const limit = file.name.startsWith('mixed-pages') ? MAX_MIXED_PAGES_PDF_BYTES : MAX_SINGLE_PAGE_PDF_BYTES;
        if (file.bytes.length >= limit) {
            throw new Error(`${file.name} is ${file.bytes.length} bytes, over its ${limit} byte budget`);
        }
    }
    files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { files, pairs };
}

/** Every fixture file, sorted by name, with its exact bytes. Pure: touches no file. */
export function buildFixtureFiles(): FixtureFile[] {
    return buildAll().files;
}

/** The codec/control pairs (not jpx-flat-gray or flate1bit) with the facts a test needs to prove the control is not blank. */
export function describeFixturePairs(): PairInfo[] {
    return buildAll().pairs;
}

/** Compares the committed folder with a fresh in-memory build. Returns one message per problem (empty = in sync). */
export function checkFixtureDirectory(directory: string): string[] {
    const problems: string[] = [];
    const expected = buildFixtureFiles();
    const expectedNames = new Set(expected.map((file) => file.name));
    for (const file of expected) {
        const path = join(directory, file.name);
        if (!existsSync(path)) {
            problems.push(`missing: ${file.name}`);
        } else if (!bytesEqual(readFileSync(path), file.bytes)) {
            problems.push(`differs from the generator output: ${file.name}`);
        }
    }
    if (existsSync(directory)) {
        for (const name of readdirSync(directory)) {
            if (name.endsWith('.pdf') && !expectedNames.has(name)) {
                problems.push(`stale file the generator does not produce: ${name}`);
            }
        }
    }
    return problems;
}

// ---------------------------------------------------------------------------------------------------------------------
// Self-test (--self-test): randomized round trips and coverage checks. Not run when the module is imported.
// ---------------------------------------------------------------------------------------------------------------------

function randomBitmap(random: () => number, maxWidth: number, maxHeight: number): Bitmap {
    const width = 1 + Math.floor(random() * maxWidth);
    const height = 1 + Math.floor(random() * maxHeight);
    const density = random() * random();
    return makeBitmap(width, height, () => random() < density);
}

/** Rows whose single transition sits at 64*k + (k % 3): hits every make-up code and the "+0" terminating codes of both colours. */
function makeupCoverageBitmap(): Bitmap {
    const width = 5200;
    const rows: Uint8Array[] = [];
    for (let k = 1; k <= 40; k++) {
        const edge = 64 * k + (k % 3);
        const whiteThenBlack = new Uint8Array(width).fill(1, edge, width);
        const blackThenWhite = new Uint8Array(width).fill(1, 0, edge);
        rows.push(whiteThenBlack, blackThenWhite);
    }
    return { width, height: rows.length, ink: concatBytes(rows) };
}

/** Every terminating code: alternating runs of 1..63 pixels of each colour. */
function terminatingCoverageBitmap(): Bitmap {
    const width = 63 * 64;
    const whiteFirst = new Uint8Array(width);
    const blackFirst = new Uint8Array(width);
    let x = 0;
    for (let run = 1; run <= 63; run++) {
        whiteFirst.fill(1, x + run, x + 2 * run);
        blackFirst.fill(1, x, x + run);
        x += 2 * run;
    }
    return { width, height: 4, ink: concatBytes([whiteFirst, blackFirst, whiteFirst, blackFirst]) };
}

export function runSelfTest(): string[] {
    const report: string[] = [];
    checkCodeTables();
    report.push('CCITT code tables: sizes, uniqueness and prefix-freeness ok');

    const random = createRandom(777);
    const totals: G4Stats = { pass: 0, horizontal: 0, vertical: 0 };
    for (let i = 0; i < 300; i++) {
        const bitmap = randomBitmap(random, 300, 20);
        const stats: G4Stats = { pass: 0, horizontal: 0, vertical: 0 };
        const decoded = decodeG4(encodeG4(bitmap, stats), bitmap.width, bitmap.height);
        expectBitmap(decoded.bitmap, bitmap, `random Group 4 bitmap ${i}`);
        expectBitmap(
            decodeG3OneDimensional(encodeG3OneDimensional(bitmap), bitmap.width, bitmap.height),
            bitmap,
            `random Group 3 bitmap ${i}`,
        );
        totals.pass += stats.pass;
        totals.horizontal += stats.horizontal;
        totals.vertical += stats.vertical;
    }
    if (totals.pass === 0 || totals.horizontal === 0 || totals.vertical === 0) {
        throw new Error(`random Group 4 bitmaps did not cover all three coding modes: ${JSON.stringify(totals)}`);
    }
    report.push(`300 random bitmaps round-trip through Group 4 and Group 3 (modes used: ${JSON.stringify(totals)})`);

    for (const [name, bitmap] of [
        ['terminating-code coverage', terminatingCoverageBitmap()],
        ['make-up-code coverage', makeupCoverageBitmap()],
        ['runs of 211x60', randomRuns(211, 60, 12345)],
    ] as const) {
        expectBitmap(decodeG4(encodeG4(bitmap), bitmap.width, bitmap.height).bitmap, bitmap, `${name} (Group 4)`);
        expectBitmap(decodeG3OneDimensional(encodeG3OneDimensional(bitmap), bitmap.width, bitmap.height), bitmap, `${name} (Group 3)`);
        expectBitmap(decodeJbig2(jbig2Mmr(bitmap)), bitmap, `${name} (JBIG2 MMR)`);
    }
    report.push('every CCITT terminating and make-up code round-trips (Group 4, Group 3, JBIG2 MMR)');

    for (let i = 0; i < 40; i++) {
        const bitmap = randomBitmap(random, 120, 40);
        expectBitmap(decodeJbig2(jbig2Arithmetic(bitmap)), bitmap, `random JBIG2 arithmetic bitmap ${i}`);
        expectBitmap(decodeJbig2(jbig2Mmr(bitmap)), bitmap, `random JBIG2 MMR bitmap ${i}`);
    }
    report.push('40 random bitmaps round-trip through JBIG2 arithmetic (MQ) and JBIG2 MMR');

    const patterns: Uint8Array[] = [
        new Uint8Array(0),
        Uint8Array.of(7),
        new Uint8Array(1000),
        new Uint8Array(1000).fill(0xff),
        Uint8Array.from({ length: 3000 }, (_, i) => (i * 7) % 251),
        Uint8Array.from({ length: 3000 }, () => Math.floor(random() * 256)),
        Uint8Array.from({ length: 4000 }, (_, i) => (i % 40 < 20 ? 0 : 255)),
    ];
    for (const pattern of patterns) {
        if (!bytesEqual(inflateSync(zlibCompress(pattern)), pattern)) {
            throw new Error('Flate round trip failed');
        }
    }
    report.push('built-in Flate writer matches zlib.inflateSync on empty, constant, periodic and random data');

    const first = buildFixtureFiles();
    const second = buildFixtureFiles();
    if (first.length !== second.length || first.some((file, index) => !bytesEqual(file.bytes, second[index].bytes))) {
        throw new Error('two builds produced different bytes');
    }
    report.push(`two in-memory builds of ${first.length} files are byte-identical`);
    return report;
}

// ---------------------------------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------------------------------

interface Options {
    mode: 'write' | 'check' | 'self-test';
    directory: string;
}

function parseArguments(argv: readonly string[]): Options {
    const options: Options = { mode: 'write', directory: FIXTURE_DIRECTORY };
    for (let i = 0; i < argv.length; i++) {
        const argument = argv[i];
        if (argument === '--check') {
            options.mode = 'check';
        } else if (argument === '--self-test') {
            options.mode = 'self-test';
        } else if (argument === '--dir' && i + 1 < argv.length) {
            options.directory = argv[++i];
        } else {
            throw new Error(`unknown argument "${argument}". Usage: generate-wasm-fixtures.ts [--check | --self-test] [--dir <folder>]`);
        }
    }
    return options;
}

function main(): number {
    const options = parseArguments(process.argv.slice(2));
    if (options.mode === 'self-test') {
        for (const line of runSelfTest()) {
            console.log(`ok  ${line}`);
        }
        return 0;
    }
    if (options.mode === 'check') {
        const problems = checkFixtureDirectory(options.directory);
        for (const problem of problems) {
            console.error(problem);
        }
        if (problems.length > 0) {
            console.error('Run "npx ts-node scripts/generate-wasm-fixtures.ts" and commit the result.');
            return 1;
        }
        console.log(`${options.directory} matches the generator output`);
        return 0;
    }
    mkdirSync(options.directory, { recursive: true });
    for (const file of buildFixtureFiles()) {
        writeFileSync(join(options.directory, file.name), file.bytes);
        console.log(`${file.name.padEnd(34)} ${String(file.bytes.length).padStart(6)} bytes`);
    }
    return 0;
}

if (require.main === module) {
    try {
        process.exitCode = main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 2;
    }
}
