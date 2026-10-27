import { describe, expect, test, vi } from 'vitest';
import type { Lookup } from '../scripts/release-postcheck';
import {
    RETRY_ATTEMPTS,
    RETRY_DELAY_MS,
    fetchAttestations,
    fetchLatestDistTag,
    fetchPublishedVersion,
    hasProvenance,
    retry,
} from '../scripts/release-postcheck';

const E404_MESSAGE =
    'Command failed: npm view pkg@4.2.2 version --json\nnpm error code E404\nnpm error 404 No match found for version 4.2.2\n';
const ATTESTATION = {
    url: 'https://registry.example.test/-/npm/v1/attestations/pkg@4.2.2',
    provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
};

function ok<T>(value: T): Lookup<T> {
    return { status: 'ok', value };
}

function absent(reason: string): Lookup<never> {
    return { status: 'absent', reason };
}

function failed(message: string): Lookup<never> {
    return { status: 'error', message };
}

// A fake registry read that replays the given results in order and counts how often it was asked.
function replay<T>(...results: Lookup<T>[]): { read: () => Lookup<T>; calls: () => number } {
    let calls = 0;
    return {
        read: () => {
            const result = results[Math.min(calls, results.length - 1)];
            calls += 1;
            return result;
        },
        calls: () => calls,
    };
}

function fakeWait(): (ms: number) => Promise<void> {
    return vi.fn(() => Promise.resolve());
}

// A fake `npm` that answers every command with the given output, or throws the given failure.
function npmPrints(output: string): (args: string[]) => string {
    return () => output;
}

function npmThrows(failure: unknown): (args: string[]) => string {
    return () => {
        throw failure;
    };
}

describe('retry', () => {
    test('waits long enough for npm to finish processing a fresh publish', () => {
        // npm took about 75 s to serve 4.3.0 after `npm publish` reported success; the old 27 s window failed.
        expect((RETRY_ATTEMPTS - 1) * RETRY_DELAY_MS).toBeGreaterThanOrEqual(5 * 60_000);
    });

    test('returns an available value at once without waiting', async () => {
        const registry = replay(ok('4.2.2'));
        const wait = fakeWait();

        await expect(retry('Q1 published version', registry.read, wait)).resolves.toBe('4.2.2');

        expect(registry.calls()).toBe(1);
        expect(wait).not.toHaveBeenCalled();
    });

    test('retries while the package or version is absent and returns the value once it appears', async () => {
        const registry = replay(absent('E404'), absent('E404'), ok('4.2.2'));
        const wait = fakeWait();

        await expect(retry('Q1 published version', registry.read, wait)).resolves.toBe('4.2.2');

        expect(registry.calls()).toBe(3);
        expect(wait).toHaveBeenCalledTimes(2);
        expect(wait).toHaveBeenCalledWith(RETRY_DELAY_MS);
    });

    test('reports an error at once with npm own message instead of retrying it as lag', async () => {
        const registry = replay(failed('npm error code E401 Unable to authenticate'));
        const wait = fakeWait();

        await expect(retry('Q1 published version', registry.read, wait)).rejects.toThrow(
            'Q1 published version: npm error code E401 Unable to authenticate',
        );

        expect(registry.calls()).toBe(1);
        expect(wait).not.toHaveBeenCalled();
    });

    test('stops at the first error even after some absent results', async () => {
        const registry = replay(absent('E404'), absent('E404'), failed('ECONNREFUSED'));
        const wait = fakeWait();

        await expect(retry('Q2 dist-tag latest', registry.read, wait)).rejects.toThrow('Q2 dist-tag latest: ECONNREFUSED');

        expect(registry.calls()).toBe(3);
        expect(wait).toHaveBeenCalledTimes(2);
    });

    test('gives up after the attempt budget and names the last npm response', async () => {
        const registry = replay(absent('first answer'), absent('E404 still not there'));
        const wait = fakeWait();

        await expect(retry('Q1 published version', registry.read, wait)).rejects.toThrow(
            `Q1 published version: still unavailable after ${RETRY_ATTEMPTS} attempts (last npm response: E404 still not there)`,
        );

        expect(registry.calls()).toBe(RETRY_ATTEMPTS);
        // No pointless wait after the final attempt.
        expect(wait).toHaveBeenCalledTimes(RETRY_ATTEMPTS - 1);
    });
});

describe('fetchPublishedVersion', () => {
    test('reads the version of the exact release from npm', () => {
        const calls: string[][] = [];
        const result = fetchPublishedVersion('pkg', '4.2.2', (args) => {
            calls.push(args);
            return '"4.2.2"\n';
        });

        expect(result).toEqual(ok('4.2.2'));
        expect(calls).toEqual([['view', 'pkg@4.2.2', 'version', '--json']]);
    });

    test('unwraps the one-element array npm 12 prints', () => {
        expect(fetchPublishedVersion('pkg', '4.2.2', npmPrints('["4.2.2"]'))).toEqual(ok('4.2.2'));
    });

    test('treats E404 as absent because the release is still propagating', () => {
        expect(fetchPublishedVersion('pkg', '4.2.2', npmThrows(new Error(E404_MESSAGE)))).toEqual(absent(E404_MESSAGE));
    });

    test.each([
        ['empty output', ''],
        ['an empty result array', '[]'],
    ])('treats %s as absent', (_name, output) => {
        expect(fetchPublishedVersion('pkg', '4.2.2', npmPrints(output)).status).toBe('absent');
    });

    test('reports any other npm failure as an error carrying its message', () => {
        const failure = new Error('Command failed: npm view\nnpm error code E401\nnpm error Unable to authenticate');

        expect(fetchPublishedVersion('pkg', '4.2.2', npmThrows(failure))).toEqual(failed(failure.message));
    });

    test('reports a thrown non-Error by its text', () => {
        expect(fetchPublishedVersion('pkg', '4.2.2', npmThrows('registry on fire'))).toEqual(failed('registry on fire'));
    });

    test('reports a value that is not a version string instead of retrying it', () => {
        expect(fetchPublishedVersion('pkg', '4.2.2', npmPrints('{"unexpected":true}'))).toEqual(
            failed('npm returned a non-string value: {"unexpected":true}'),
        );
    });

    test('reports output that is not JSON as an error', () => {
        const result = fetchPublishedVersion('pkg', '4.2.2', npmPrints('npm warn something'));

        expect(result.status).toBe('error');
        expect(result).toMatchObject({ message: expect.stringContaining('unexpected npm output') });
    });

    test('reports an ambiguous multi-result answer as an error', () => {
        expect(fetchPublishedVersion('pkg', '4.2.2', npmPrints('["4.2.1","4.2.2"]'))).toEqual(
            failed('unexpected npm output: Expected one npm JSON result, received 2'),
        );
    });
});

describe('fetchLatestDistTag', () => {
    test('reads the latest dist-tag of the package', () => {
        const calls: string[][] = [];
        const result = fetchLatestDistTag('pkg', (args) => {
            calls.push(args);
            return '"4.2.2"';
        });

        expect(result).toEqual(ok('4.2.2'));
        expect(calls).toEqual([['view', 'pkg', 'dist-tags.latest', '--json']]);
    });

    test('treats a missing tag and E404 as absent, and other failures as errors', () => {
        expect(fetchLatestDistTag('pkg', npmPrints('')).status).toBe('absent');
        expect(fetchLatestDistTag('pkg', npmThrows(new Error(E404_MESSAGE))).status).toBe('absent');
        expect(fetchLatestDistTag('pkg', npmThrows(new Error('ECONNRESET'))).status).toBe('error');
    });

    test('reports a tag that is not a string as an error', () => {
        expect(fetchLatestDistTag('pkg', npmPrints('["4.2.1","4.2.2"]')).status).toBe('error');
        expect(fetchLatestDistTag('pkg', npmPrints('42'))).toEqual(failed('npm returned a non-string value: 42'));
    });
});

describe('fetchAttestations', () => {
    test('reads the attestation of the exact release from the version manifest', () => {
        const calls: string[][] = [];
        const result = fetchAttestations('pkg', '4.2.2', (args) => {
            calls.push(args);
            return JSON.stringify({ version: '4.2.2', dist: { attestations: ATTESTATION } });
        });

        expect(result).toEqual(ok(ATTESTATION));
        expect(calls).toEqual([['view', 'pkg@4.2.2', '--json']]);
    });

    test('unwraps the one-element array npm 12 prints', () => {
        const output = JSON.stringify([{ dist: { attestations: ATTESTATION } }]);

        expect(fetchAttestations('pkg', '4.2.2', npmPrints(output))).toEqual(ok(ATTESTATION));
    });

    test.each([
        ['has no dist', { version: '4.2.2' }],
        ['has a dist without attestations', { version: '4.2.2', dist: { tarball: 'https://registry.example.test/pkg.tgz' } }],
    ])('returns a visible version that %s as ok with no attestation, not as absent', (_name, manifest) => {
        expect(fetchAttestations('pkg', '4.2.2', npmPrints(JSON.stringify(manifest)))).toEqual(ok(undefined));
    });

    test('treats E404 as absent and other failures as errors', () => {
        expect(fetchAttestations('pkg', '4.2.2', npmThrows(new Error(E404_MESSAGE)))).toEqual(absent(E404_MESSAGE));
        expect(fetchAttestations('pkg', '4.2.2', npmThrows(new Error('ECONNRESET')))).toEqual(failed('ECONNRESET'));
    });

    test('reports a manifest that is not an object as an error', () => {
        expect(fetchAttestations('pkg', '4.2.2', npmPrints('"4.2.2"'))).toEqual(failed('npm returned a non-object manifest: "4.2.2"'));
    });

    test('does not retry a visible version without provenance, but waits for a version that is still propagating', async () => {
        const withoutProvenance = replay(fetchAttestations('pkg', '4.2.2', npmPrints('{"version":"4.2.2","dist":{}}')));
        const wait = fakeWait();

        const attestations = await retry('Q3 provenance attestation', withoutProvenance.read, wait);

        expect(attestations).toBeUndefined();
        expect(hasProvenance(attestations)).toBe(false);
        expect(withoutProvenance.calls()).toBe(1);
        expect(wait).not.toHaveBeenCalled();

        const lagging = replay(
            fetchAttestations('pkg', '4.2.2', npmThrows(new Error(E404_MESSAGE))),
            fetchAttestations('pkg', '4.2.2', npmPrints(JSON.stringify({ dist: { attestations: ATTESTATION } }))),
        );

        await expect(retry('Q3 provenance attestation', lagging.read, wait)).resolves.toEqual(ATTESTATION);
        expect(lagging.calls()).toBe(2);
        expect(wait).toHaveBeenCalledTimes(1);
    });
});

describe('hasProvenance', () => {
    test.each([
        ['no attestation at all', undefined, false],
        ['an attestation object with neither url nor provenance', {}, false],
        ['an attestation with a url', { url: ATTESTATION.url }, true],
        ['an attestation with a provenance statement', { provenance: ATTESTATION.provenance }, true],
        ['a complete attestation', ATTESTATION, true],
    ])('%s', (_name, attestations, expected) => {
        expect(hasProvenance(attestations)).toBe(expected);
    });
});
