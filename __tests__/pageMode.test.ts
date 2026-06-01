import { describe, expect, test } from 'vitest';
import type { OutputSink } from '../src/interfaces/output.sink';
import { normalizePdfToPngOptions } from '../src/normalizePdfToPngOptions';
import { optionsToPageMode, type PageMode } from '../src/pageMode';

const stubSink: OutputSink = {
    write: async () => '/dev/null/stub.png',
};

interface Row {
    readonly title: string;
    readonly returnMetadataOnly: boolean;
    readonly returnPageContent: boolean;
    readonly withSink: boolean;
    readonly expected: PageMode;
}

const rows: Row[] = [
    {
        title: 'metadata-only short-circuits regardless of sink/content',
        returnMetadataOnly: true,
        returnPageContent: true,
        withSink: false,
        expected: { kind: 'metadata' },
    },
    {
        title: 'sink present + returnPageContent true → file keeping content',
        returnMetadataOnly: false,
        returnPageContent: true,
        withSink: true,
        expected: { kind: 'file', sink: stubSink, returnContent: true },
    },
    {
        title: 'sink present + returnPageContent false → file stripping content',
        returnMetadataOnly: false,
        returnPageContent: false,
        withSink: true,
        expected: { kind: 'file', sink: stubSink, returnContent: false },
    },
    {
        title: 'no sink + returnPageContent true → in-memory content',
        returnMetadataOnly: false,
        returnPageContent: true,
        withSink: false,
        expected: { kind: 'content', returnContent: true },
    },
    {
        title: 'no sink + returnPageContent false → in-memory, content discarded',
        returnMetadataOnly: false,
        returnPageContent: false,
        withSink: false,
        expected: { kind: 'content', returnContent: false },
    },
];

describe('optionsToPageMode', () => {
    for (const row of rows) {
        test(row.title, () => {
            const opts = normalizePdfToPngOptions({
                returnMetadataOnly: row.returnMetadataOnly,
                returnPageContent: row.returnPageContent,
            });
            const mode = optionsToPageMode(opts, row.withSink ? stubSink : undefined);
            expect(mode).toEqual(row.expected);
        });
    }

    test('metadata mode ignores a provided sink', () => {
        const opts = normalizePdfToPngOptions({ returnMetadataOnly: true });
        expect(optionsToPageMode(opts, stubSink)).toEqual({ kind: 'metadata' });
    });
});
