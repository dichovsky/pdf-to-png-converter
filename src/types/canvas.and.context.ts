import { Canvas, SKRSContext2D } from '@napi-rs/canvas';

export type CanvasAndContext = {
    canvas?: Canvas;
    context?: SKRSContext2D;
};
