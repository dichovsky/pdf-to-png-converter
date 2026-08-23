/**
 * Normalizes the JSON envelope emitted by `npm view` for a query that should return one value.
 * npm 11 emits the value directly, while npm 12 wraps the same value in a one-element array.
 */
export function parseSingleNpmJsonResult(output: string): unknown | null {
    const trimmed = output.trim();
    if (trimmed === '') {
        return null;
    }

    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
        return parsed;
    }
    if (parsed.length === 0) {
        return null;
    }
    if (parsed.length !== 1) {
        throw new Error(`Expected one npm JSON result, received ${parsed.length}`);
    }
    return parsed[0];
}
