import { Canvas, type SKRSContext2D } from '@napi-rs/canvas';

export type CanvasAndContext = {
    canvas: Canvas | null;
    context: SKRSContext2D | null;
};
