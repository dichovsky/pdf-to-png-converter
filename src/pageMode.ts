import type { OutputSink } from './interfaces/output.sink.js';
import type { NormalizedPdfToPngOptions } from './normalizePdfToPngOptions.js';

/**
 * The per-page rendering/output mode, derived once per conversion from the normalized options.
 *
 * Modelled as a discriminated union mirroring `PngPageOutput['kind']` so the option puzzle is a
 * single pure mapping instead of a web of co-dependent booleans, and so `processAndSavePage` can
 * switch on `kind` without the `path === ''` sentinel that previously signalled "nothing written".
 *
 * - `metadata` — no rendering; dimensions + rotation only.
 * - `content`  — render in memory; `returnContent` decides whether the Buffer is kept on the result.
 * - `file`     — render and write through `sink`; `returnContent` decides whether the Buffer is also
 *   returned on the result (it is always rendered so it can be written).
 */
export type PageMode =
    | { readonly kind: 'metadata' }
    | { readonly kind: 'content'; readonly returnContent: boolean }
    | { readonly kind: 'file'; readonly sink: OutputSink; readonly returnContent: boolean };

/**
 * Pure mapping from normalized options (+ the resolved output sink, if writing to disk) to a
 * `PageMode`. `sink` is non-undefined exactly when an output folder is in effect; building it
 * requires filesystem I/O, so the caller constructs it and passes it in to keep this function pure
 * and table-testable.
 */
export function optionsToPageMode(opts: NormalizedPdfToPngOptions, sink: OutputSink | undefined): PageMode {
    if (opts.returnMetadataOnly) {
        return { kind: 'metadata' };
    }
    if (sink !== undefined) {
        return { kind: 'file', sink, returnContent: opts.returnPageContent };
    }
    return { kind: 'content', returnContent: opts.returnPageContent };
}
