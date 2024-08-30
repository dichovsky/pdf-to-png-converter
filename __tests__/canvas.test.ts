import { expect, test } from 'vitest';
import { CanvasContext, NodeCanvasFactory } from '../src/node.canvas.factory';
import { Canvas } from 'canvas';

test('should reset the canvas width and height', () => {
    const canvasAndContext: CanvasContext = {
        canvas: {
            width: 100,
            height: 200,
        } as Canvas,
        context: {} as any,
    };
    const factory = new NodeCanvasFactory();

    factory.reset(canvasAndContext, 300, 400);

    expect(canvasAndContext.canvas).to.not.be.undefined;
    expect(canvasAndContext!.canvas!.width).to.equal(300);
    expect(canvasAndContext!.canvas!.height).to.equal(400);
});

test('should throw an error if canvas is not specified', () => {
    const canvasAndContext: CanvasContext = {
        canvas: undefined,
        context: {} as any,
    };
    const factory = new NodeCanvasFactory();

    expect(() => factory.reset(canvasAndContext, 300, 400)).to.throw('Canvas is not specified');
});

test('should throw an error if width or height is less than or equal to zero', () => {
    const canvasAndContext: CanvasContext = {
        canvas: {
            width: 100,
            height: 200,
        } as Canvas,
        context: {} as any,
    };
    const factory = new NodeCanvasFactory();

    expect(() => factory.reset(canvasAndContext, 0, 400)).to.throw('Invalid canvas size');
    expect(() => factory.reset(canvasAndContext, 300, -1)).to.throw('Invalid canvas size');
});