import { Canvas } from '@napi-rs/canvas';
import { strict } from 'node:assert';
import { CanvasAndContext } from './types';

export class NodeCanvasFactory {
    /**
     * Creates a new canvas context with the specified width and height.
     * @param width The width of the canvas.
     * @param height The height of the canvas.
     * @returns A new canvas context with the specified width and height.
     * @throws An error if the width or height is less than or equal to zero.
     */
    create(width: number, height: number) {
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
        strict(canvasAndContext.canvas, 'Canvas is not specified');
        strict(width > 0 && height > 0, 'Invalid canvas size');
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
    }

    /**
     * Destroys the canvas and its context by setting the canvas width and height to 0 and
     * setting the canvas and context properties to undefined.
     * @param canvasAndContext - The canvas and its context to be destroyed.
     */
    destroy(canvasAndContext: CanvasAndContext): void {
        strict(canvasAndContext.canvas, 'Canvas is not specified');
        canvasAndContext.canvas = undefined;
        canvasAndContext.context = undefined;
    }
}
