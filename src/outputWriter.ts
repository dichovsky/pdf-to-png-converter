import { promises as fsPromises } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

// Reject only characters the host OS treats as path separators. On POSIX, "\" is a valid
// filename character (e.g. PDFs named `foo\bar.pdf` produce a default mask of `foo\bar`) so
// rejecting it would break legitimate flat-filename conversions there. See SEC-001 in
// CHANGELOG / BACKLOG for the threat model.
const PATH_SEPARATOR_PATTERN = sep === '\\' ? /[\\/]/ : /\//;
const SEPARATOR_DESCRIPTION = sep === '\\' ? '"/" or "\\"' : '"/"';

function isEscapingRelativePath(rel: string): boolean {
    return rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel);
}

/**
 * Writes a rendered PNG page to disk using an exclusive-create open (`'wx'`) and returns the final path.
 *
 * The `name` argument must be a flat filename containing no host path separators — `/` on
 * POSIX, and both `/` and `\` on Windows. On POSIX, `\` is a valid filename character and is
 * intentionally allowed (e.g. PDFs named `foo\bar.pdf` produce a default mask of `foo\bar`).
 * Rejecting separators here closes the TOCTOU window on intermediate directory components (an
 * attacker with write access to the output folder could otherwise swap a sub-directory for a
 * symlink between the realpath check and the `open()` call). The `'wx'` flag additionally
 * prevents overwriting an existing target and blocks following a pre-existing symlink at the
 * target filename on POSIX systems. Callers should clear the output folder before re-running
 * the same conversion if they expect to reuse the same output names. The input object is not
 * mutated; callers receive the resolved path from the return value.
 */
export async function savePNGfile(name: string, content: Buffer, resolvedOutputFolder: string, realOutputFolder: string): Promise<string> {
    if (PATH_SEPARATOR_PATTERN.test(name)) {
        throw new Error(`Output file name must be a flat filename without ${SEPARATOR_DESCRIPTION} path separators: ${name}`);
    }

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
