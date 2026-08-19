declare module 'pngjs' {
    export interface PNG {
        data: Uint8Array;
        width: number;
        height: number;
    }

    export interface PNGWithMetadata extends PNG {}
}
