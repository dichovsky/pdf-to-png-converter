import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'node:path';
import comparePng, { ComparePngOptions } from 'png-visual-compare';

export function comparePNG(
    actualFilePathOrBuffer: string | Buffer,
    expectedFilePath: string,
    opts?: ComparePngOptions,
) {
    if (!existsSync(expectedFilePath)) {
        const expectedFileDir = parse(expectedFilePath).dir;
        if (!existsSync(expectedFileDir)) {
            mkdirSync(expectedFileDir, { recursive: true });
        }
        const actualBuffer: Buffer =
            typeof actualFilePathOrBuffer === 'string' ? readFileSync(actualFilePathOrBuffer) : actualFilePathOrBuffer;
        writeFileSync(expectedFilePath, actualBuffer);
    }
    return comparePng(actualFilePathOrBuffer, expectedFilePath, opts);
}
