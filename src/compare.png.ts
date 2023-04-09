import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import comparePng, { ComparePngOptions } from 'png-visual-compare';
import {parse} from 'path';
import { mkdirSync } from 'node:fs';
export function comparePNG(
    actualFilePathOrBuffer: string | Buffer,
    expectedFilePath: string,
    opts?: ComparePngOptions,
) {
    if (!existsSync(expectedFilePath)) {
        const expectedFileDir = parse(expectedFilePath).dir
        if(!existsSync(expectedFileDir)) {
            mkdirSync(expectedFileDir, {recursive: true});
        }
        const actualBuffer: Buffer = typeof actualFilePathOrBuffer === 'string' 
            ? readFileSync(actualFilePathOrBuffer) 
            : actualFilePathOrBuffer;
        writeFileSync(expectedFilePath, actualBuffer);

    }
    return comparePng(actualFilePathOrBuffer, expectedFilePath, opts);
}
