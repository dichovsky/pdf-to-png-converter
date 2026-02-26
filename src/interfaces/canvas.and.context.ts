import type { Canvas} from '@napi-rs/canvas';
import { type SKRSContext2D } from '@napi-rs/canvas';

/**
 * Holds a reference to an `@napi-rs/canvas` `Canvas` instance and its 2D rendering context.
 *
 * Both fields are nullable so that `NodeCanvasFactory.destroy()` can zero out the canvas
 * dimensions and release the references without needing a separate wrapper type.
 * After `destroy()` is called, both `canvas` and `context` are set to `null`.
 */
export interface CanvasAndContext {
    /** The canvas instance used for rendering a PDF page. `null` after `NodeCanvasFactory.destroy()` is called. */
    canvas: Canvas | null;
    /** The 2D rendering context for `canvas`. `null` after `NodeCanvasFactory.destroy()` is called. */
    context: SKRSContext2D | null;
}
