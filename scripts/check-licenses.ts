import { readFileSync } from 'node:fs';
import satisfies from 'spdx-satisfies';
import { isMainModule } from './is-main-module.ts';

interface LockedPackage {
    dev?: boolean;
    license?: string;
}

const approvedLicenses = ['ISC', 'MIT', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'BSD-4-Clause', 'Apache-2.0', 'Unlicense'];

export function isApprovedLicense(license: string | undefined): boolean {
    if (license === 'BSD') return true;
    if (!license) return false;
    try {
        return satisfies(license, approvedLicenses);
    } catch {
        return false;
    }
}

if (isMainModule(import.meta)) {
    // Include optional runtime binaries for every platform, even when this host did not install them.
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')) as {
        packages: Record<string, LockedPackage>;
    };
    for (const [path, pkg] of Object.entries(lock.packages)) {
        if (!pkg.dev && !isApprovedLicense(pkg.license)) {
            throw new Error(`Unapproved production license in ${path}: ${pkg.license ?? 'unknown'}`);
        }
    }
}
