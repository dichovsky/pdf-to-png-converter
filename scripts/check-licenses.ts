import { readFileSync } from 'node:fs';

interface LockedPackage {
    dev?: boolean;
    license?: string;
}

// Include optional runtime binaries for every platform, even when this host did not install them.
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')) as {
    packages: Record<string, LockedPackage>;
};
const allowed = new Set(['ISC', 'MIT', 'MIT OR X11', '(MIT OR X11)', 'BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'Unlicense']);
for (const [path, pkg] of Object.entries(lock.packages)) {
    if (!pkg.dev && !allowed.has(pkg.license ?? '')) {
        throw new Error(`Unapproved production license in ${path}: ${pkg.license ?? 'unknown'}`);
    }
}
