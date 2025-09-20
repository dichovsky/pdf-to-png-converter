import { Canvas } from '@napi-rs/canvas';
import { strict as assert } from 'node:assert';
import type { CanvasAndContext } from './types';

export class NodeCanvasFactory {
    /**
     * Creates a new canvas context with the specified width and height.
     * @param width The width of the canvas.
     * @param height The height of the canvas.
     * @returns A new canvas context with the specified width and height.
     * @throws An error if the width or height is less than or equal to zero.
     */
    create(width: number, height: number): CanvasAndContext {
        assert.ok(width > 0 && height > 0, 'Canvas width and height must be greater than zero');
        const canvas = new Canvas(width, height);

        return {
            canvas,
            context: canvas.getContext('2d'),
        };
    }

    /**
     * Resets the canvas to the specified width and height.
     * @param canvasAndContext - The canvas and its context.
     * @param width - The new width of the canvas.
     * @param height - The new height of the canvas.
     */
    reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
        assert.ok(canvasAndContext.canvas, 'Canvas object is required');
        assert.ok(width > 0 && height > 0, 'Canvas width and height must be greater than zero');
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
        canvasAndContext.context = canvasAndContext.canvas.getContext('2d');
    }

    /**
     * Destroys the canvas and its context by setting the canvas width and height to 0 and
     * setting the canvas and context properties to undefined.
     * @param canvasAndContext - The canvas and its context to be destroyed.
     */
    destroy(canvasAndContext: CanvasAndContext): void {
        assert.ok(canvasAndContext.canvas, 'Canvas object is required');
        canvasAndContext.canvas.width = 0;
        canvasAndContext.canvas.height = 0;
        canvasAndContext.canvas = null;
        canvasAndContext.context = null;
    }
}
