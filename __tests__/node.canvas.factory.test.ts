import { describe, it, expect } from 'vitest';
import { NodeCanvasFactory } from '../src/node.canvas.factory';

describe('NodeCanvasFactory', () => {
  it('should create a new canvas and context', () => {
    const canvasFactory = new NodeCanvasFactory();
    const canvasAndContext = canvasFactory.create(100, 200);

    expect(canvasAndContext.canvas).toBeDefined();
    expect(canvasAndContext.context).toBeDefined();
    expect(canvasAndContext!.canvas!.width).toBe(100);
    expect(canvasAndContext!.canvas!.height).toBe(200);
  });

  it('should throw an error if width or height is zero or less', () => {
    const canvasFactory = new NodeCanvasFactory();

    expect(() => canvasFactory.create(0, 200)).toThrow('Canvas width and height must be greater than zero');
    expect(() => canvasFactory.create(100, 0)).toThrow('Canvas width and height must be greater than zero');
    expect(() => canvasFactory.create(-100, 200)).toThrow('Canvas width and height must be greater than zero');
    expect(() => canvasFactory.create(100, -200)).toThrow('Canvas width and height must be greater than zero');
  });

  it('should reset the canvas', () => {
    const canvasFactory = new NodeCanvasFactory();
    const canvasAndContext = canvasFactory.create(100, 200);

    canvasFactory.reset(canvasAndContext, 300, 400);

    expect(canvasAndContext!.canvas!.width).toBe(300);
    expect(canvasAndContext!.canvas!.height).toBe(400);
  });

  it('should throw an error if canvas is not provided for reset', () => {
    const canvasFactory = new NodeCanvasFactory();

    expect(() => canvasFactory.reset({ canvas: null, context: null }, 300, 400)).toThrow('Canvas object is required');
  });

  it('should throw an error if width or height is zero or less for reset', () => {
    const canvasFactory = new NodeCanvasFactory();
    const canvasAndContext = canvasFactory.create(100, 200);

    expect(() => canvasFactory.reset(canvasAndContext, 0, 400)).toThrow('Canvas width and height must be greater than zero');
    expect(() => canvasFactory.reset(canvasAndContext, 300, 0)).toThrow('Canvas width and height must be greater than zero');
    expect(() => canvasFactory.reset(canvasAndContext, -300, 400)).toThrow('Canvas width and height must be greater than zero');
    expect(() => canvasFactory.reset(canvasAndContext, 300, -400)).toThrow('Canvas width and height must be greater than zero');
  });

  it('should destroy the canvas', () => {
    const canvasFactory = new NodeCanvasFactory();
    const canvasAndContext = canvasFactory.create(100, 200);

    canvasFactory.destroy(canvasAndContext);

    expect(canvasAndContext.canvas).toBeNull();
    expect(canvasAndContext.context).toBeNull();
  });

  it('should throw an error if canvas is not provided for destroy', () => {
    const canvasFactory = new NodeCanvasFactory();

    expect(() => canvasFactory.destroy({ canvas: null, context: null })).toThrow('Canvas object is required');
  });
});
