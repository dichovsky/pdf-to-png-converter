export interface CanvasContext {
    canvas?: any;
    context?: any;
}

export interface NodeCanvasFactory {
    create(width: number, height: number): CanvasContext;
    reset(canvasAndContext: CanvasContext, width: number, height: number): void;
    destroy(canvasAndContext: CanvasContext): void;
}
