import { strict } from 'node:assert';
import Canvas from 'canvas';

export interface CanvasContext {
    canvas?: Canvas.Canvas;
    context?: Canvas.CanvasRenderingContext2D;
}

export class NodeCanvasFactory {
    /**
     * Creates a new canvas context with the specified width and height.
     * @param width The width of the canvas.
     * @param height The height of the canvas.
     * @returns A new canvas context with the specified width and height.
     * @throws An error if the width or height is less than or equal to zero.
     */
    create(width: number, height: number): CanvasContext {
        strict(width > 0 && height > 0, 'Invalid canvas size');
        const canvas = Canvas.createCanvas(width, height);
        const context = canvas.getContext('2d');
        return {
            canvas,
            context,
        };
    }

    /**
     * Resets the canvas to the specified width and height.
     * @param canvasAndContext - The canvas and its context.
     * @param width - The new width of the canvas.
     * @param height - The new height of the canvas.
     */
    reset(canvasAndContext: CanvasContext, width: number, height: number): void {
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
    destroy(canvasAndContext: CanvasContext): void {
        strict(canvasAndContext.canvas, 'Canvas is not specified');
        canvasAndContext.canvas.width = 0;
        canvasAndContext.canvas.height = 0;
        canvasAndContext.canvas = undefined;
        canvasAndContext.context = undefined;
    }
}
