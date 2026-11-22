import { createCanvas, loadImage } from '@napi-rs/canvas';

export interface DecodedPng {
    width: number;
    height: number;
    /** RGBA bytes, row by row. */
    data: Uint8ClampedArray;
}

export async function decodePng(png: Uint8Array): Promise<DecodedPng> {
    const image = await loadImage(Buffer.from(png));
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
}
