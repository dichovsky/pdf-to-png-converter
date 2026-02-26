import { Canvas } from '@napi-rs/canvas';
import { strict as assert } from 'node:assert';
import type { CanvasAndContext } from './interfaces';

/**
 * Canvas factory used by pdfjs to create and manage `@napi-rs/canvas` instances during PDF rendering.
 *
 * pdfjs expects a canvas factory that implements `create`, `reset`, and `destroy` methods.
 * This class satisfies that contract using the native `@napi-rs/canvas` package, which provides
 * a Node.js-compatible canvas without requiring a browser environment.
 *
 * An instance of this class is created per page render inside `processPdfPage` and is also
 * optionally attached to the `PDFDocumentProxy` as `canvasFactory` for reuse.
 */
export class NodeCanvasFactory {
    /**
     * Creates a new canvas and 2D rendering context with the specified dimensions.
     *
     * @param width - Width of the canvas in pixels. Must be greater than zero.
     * @param height - Height of the canvas in pixels. Must be greater than zero.
     * @returns A `CanvasAndContext` holding the newly created canvas and its 2D context.
     * @throws {AssertionError} If `width` or `height` is less than or equal to zero.
     */
    public create(width: number, height: number): CanvasAndContext {
        assert.ok(width > 0 && height > 0, 'Canvas width and height must be greater than zero');
        const canvas = new Canvas(width, height);

        return {
            canvas,
            context: canvas.getContext('2d'),
        };
    }

    /**
     * Resizes an existing canvas to the specified dimensions and refreshes its 2D context.
     *
     * Reassigns `canvasAndContext.context` to a new context from the resized canvas.
     * The existing canvas instance is reused; no new canvas is created.
     *
     * @param canvasAndContext - The canvas and context pair to resize. `canvas` must not be `null`.
     * @param width - New width in pixels. Must be greater than zero.
     * @param height - New height in pixels. Must be greater than zero.
     * @throws {AssertionError} If `canvasAndContext.canvas` is `null`.
     * @throws {AssertionError} If `width` or `height` is less than or equal to zero.
     */
    public reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
        assert.ok(canvasAndContext.canvas, 'Canvas object is required');
        assert.ok(width > 0 && height > 0, 'Canvas width and height must be greater than zero');
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
        canvasAndContext.context = canvasAndContext.canvas.getContext('2d');
    }

    /**
     * Releases the canvas resources by zeroing its dimensions and setting both `canvas` and `context` to `null`.
     *
     * After this call, `canvasAndContext.canvas` and `canvasAndContext.context` are both `null`.
     * This method is called automatically by `processPdfPage` in the `finally` block to prevent
     * memory leaks after each page render.
     *
     * @param canvasAndContext - The canvas and context pair to destroy. `canvas` must not be `null`.
     * @throws {AssertionError} If `canvasAndContext.canvas` is `null`.
     */
    public destroy(canvasAndContext: CanvasAndContext): void {
        assert.ok(canvasAndContext.canvas, 'Canvas object is required');
        canvasAndContext.canvas.width = 0;
        canvasAndContext.canvas.height = 0;
        canvasAndContext.canvas = null;
        canvasAndContext.context = null;
    }
}
