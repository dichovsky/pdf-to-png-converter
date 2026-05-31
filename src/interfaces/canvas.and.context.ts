import type { Canvas, SKRSContext2D } from '@napi-rs/canvas';

/**
 * Holds a reference to an `@napi-rs/canvas` `Canvas` instance and its 2D rendering context,
 * as produced by pdf.js's built-in Node canvas factory (which is backed by `@napi-rs/canvas`).
 *
 * Both fields are nullable: pdf.js's `canvasFactory.destroy()` zeroes out the canvas dimensions
 * and sets both `canvas` and `context` to `null` to release the references after each page render.
 */
export interface CanvasAndContext {
    /** The canvas instance used for rendering a PDF page. `null` after the factory's `destroy()` is called. */
    canvas: Canvas | null;
    /** The 2D rendering context for `canvas`. `null` after the factory's `destroy()` is called. */
    context: SKRSContext2D | null;
}
