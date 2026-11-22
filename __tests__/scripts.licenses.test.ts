import { expect, test } from 'vitest';
import { isApprovedLicense } from '../scripts/check-licenses';

test.each(['BSD', '0BSD', 'BSD-4-Clause', 'MIT OR X11', '(MIT OR Apache-2.0)', 'MIT AND ISC'])('accepts %s', (license) => {
    expect(isApprovedLicense(license)).toBe(true);
});

test.each(['Apache 2.0', 'Apache License, Version 2.0', 'MIT License', 'BSD 3-Clause', 'mit'])('accepts the legacy name %s', (license) => {
    expect(isApprovedLicense(license)).toBe(true);
});

const rejected = [undefined, 'unknown', 'UNLICENSED', 'LicenseRef-MIT', 'GPL-3.0-only', 'MIT AND GPL-3.0-only', 'MIT OR'];
test.each(rejected)('rejects %s', (license) => {
    expect(isApprovedLicense(license)).toBe(false);
});
