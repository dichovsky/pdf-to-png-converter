import { promises as fsPromises } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

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
 * target filename on POSIX systems. Because the filename is flat, the file's directory IS the
 * output folder itself, so a single fresh `realpath` of the output folder immediately before
 * `open()` — compared for exact equality with the value captured at conversion start — detects
 * any symlink swap or rename of the folder or its ancestors in one syscall (equality is strictly
 * stronger than a containment check). Callers should clear the output folder before re-running
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

    // '.' collapses to the output folder itself under join() (bypassing the escape checks below,
    // since relative() yields ''), and would surface as a raw EEXIST/EISDIR from open() that
    // leaks the absolute folder path. '..' needs no twin guard: it resolves to the PARENT folder,
    // which the escaping-relative check below already rejects cleanly.
    if (name === '.') {
        throw new Error(`Output file name must be a plain filename, received: ${name}`);
    }

    const resolvedFilePath = join(resolvedOutputFolder, name);
    if (isEscapingRelativePath(relative(resolvedOutputFolder, resolvedFilePath))) {
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
