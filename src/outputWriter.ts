import { promises as fsPromises } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

// Reject only characters the host OS treats as path separators. On Windows both "\\" and "/"
// are separators; on POSIX only "/" is. A backslash therefore remains a valid POSIX filename
// character, including when it comes from a PDF basename.
const PATH_SEPARATOR_PATTERN = sep === '\\' ? /[\\/]/ : /\//;
const SEPARATOR_DESCRIPTION = sep === '\\' ? '"/" or "\\"' : '"/"';

function isEscapingRelativePath(rel: string): boolean {
    return rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel);
}

/**
 * Validates the host-specific, folder-independent part of the disk filename contract.
 *
 * Call this while preflighting page names so invalid names fail before output-folder creation,
 * and call it again at the write boundary as defense in depth. The target must be one plain path
 * segment: no empty name, current/parent directory aliases, absolute path, or host separator.
 */
export function assertValidOutputFilename(name: string): void {
    if (name === '') {
        throw new Error('Output file name must be a non-empty plain filename.');
    }

    if (PATH_SEPARATOR_PATTERN.test(name)) {
        throw new Error(`Output file name must be a flat filename without ${SEPARATOR_DESCRIPTION} path separators: ${name}`);
    }

    if (isAbsolute(name) || name === '..') {
        throw new Error(`Output file name escapes the output folder: ${name}`);
    }

    // '.' collapses to the output folder itself under join().
    if (name === '.') {
        throw new Error(`Output file name must be a plain filename, received: ${name}`);
    }
}

/**
 * The prepared output folder: its absolute path, plus the `realpath` captured at conversion
 * start. The two are only meaningful together — every write re-reads the folder's realpath and
 * compares it against `realOutputFolder` — so they travel as one value rather than as two
 * strings callers must keep in sync.
 */
export interface OutputFolderHandle {
    readonly resolvedOutputFolder: string;
    readonly realOutputFolder: string;
}

/**
 * Resolves `outputFolder` against the process CWD. Kept separate from `prepareOutputFolder` so the
 * CWD is captured at conversion start, before any user-supplied `outputFileMaskFunc` runs: a mask
 * callback that calls `process.chdir()` must not be able to redirect where a relative
 * `outputFolder` lands.
 */
export function resolveOutputFolder(outputFolder: string): string {
    return resolve(outputFolder);
}

/**
 * Creates the already-resolved output folder and captures its `realpath` as the baseline every
 * subsequent write is checked against. Colocated with `savePNGfile` so the whole SEC-001/002/003
 * threat model — folder creation, the realpath baseline, and the per-write re-check that consumes
 * it — lives in this one module.
 *
 * Callers must reject duplicate output filenames BEFORE calling this: it is the first output I/O
 * of a conversion, and running it earlier would leave a created directory behind on a conversion
 * that then fails validation.
 */
export async function prepareOutputFolder(resolvedOutputFolder: string): Promise<OutputFolderHandle> {
    await fsPromises.mkdir(resolvedOutputFolder, { recursive: true });
    const realOutputFolder = await fsPromises.realpath(resolvedOutputFolder);
    return { resolvedOutputFolder, realOutputFolder };
}

/**
 * Writes a rendered PNG page to disk using an exclusive-create open (`'wx'`) and returns the final path.
 *
 * Flat filenames remove attacker-controlled intermediate path components. The fresh `realpath`
 * comparison detects when the folder pathname resolves to a different canonical pathname than it
 * did at preparation time. It does not bind the write to a directory inode: replacing a directory
 * at the same canonical pathname is not detectable by string equality, and the pathname can still
 * be changed between this check and `open()`. Callers must therefore use an output directory that
 * is not writable by untrusted users.
 *
 * The exclusive-create (`'wx'`) open prevents overwriting an existing final target and refuses a
 * pre-existing target symlink under normal local-filesystem semantics. Callers should clear the
 * output folder before re-running a conversion if they expect to reuse the same names.
 */
export async function savePNGfile(name: string, content: Buffer, folder: OutputFolderHandle): Promise<string> {
    const { resolvedOutputFolder, realOutputFolder } = folder;

    assertValidOutputFilename(name);

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
