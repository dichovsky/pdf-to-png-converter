import { promises as fsPromises } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
function isEscapingRelativePath(rel: string): boolean {
    return rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel);
}

/**
 * Writes a rendered PNG page to disk using an exclusive-create open (`'wx'`) and returns the final path.
 *
 * This prevents overwriting an existing file and blocks following a pre-existing symlink
 * at the target filename on POSIX systems. Callers should clear the output folder before
 * re-running the same conversion if they expect to reuse the same output names. The input
 * object is not mutated; callers receive the resolved path from the return value.
 *
 * A residual TOCTOU window still exists for directory-component swaps, so the containment
 * checks and final realpath re-check remain necessary.
 */
export async function savePNGfile(name: string, content: Buffer, resolvedOutputFolder: string, realOutputFolder: string): Promise<string> {
    if (isAbsolute(name)) {
        throw new Error(`Output file name escapes the output folder: ${name}`);
    }

    const resolvedFilePath = join(resolvedOutputFolder, name);
    if (isEscapingRelativePath(relative(resolvedOutputFolder, resolvedFilePath))) {
        throw new Error(`Output file name escapes the output folder: ${name}`);
    }

    const realFileDir = await fsPromises.realpath(dirname(resolvedFilePath));
    if (isEscapingRelativePath(relative(realOutputFolder, realFileDir))) {
        throw new Error(`Output file name escapes the output folder: ${name}`);
    }

    if (!Buffer.isBuffer(content)) {
        throw new Error(`Cannot write PNG file "${resolvedFilePath}" because content is not a Buffer.`);
    }

    const realOutputFolderFinal = await fsPromises.realpath(resolvedOutputFolder);
    if (realOutputFolderFinal !== realOutputFolder) {
        throw new Error(`Output folder was modified during write: ${resolvedOutputFolder}`);
    }

    const fd = await fsPromises.open(resolvedFilePath, 'wx');
    try {
        await fd.writeFile(content);
    } finally {
        await fd.close();
    }

    return resolvedFilePath;
}
