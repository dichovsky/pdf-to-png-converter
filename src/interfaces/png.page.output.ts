export type PageRotation = 0 | 90 | 180 | 270;

interface BasePngPageOutput {
    pageNumber: number;
    name: string;
    width: number;
    height: number;
    rotation: PageRotation;
}

export interface MetadataPngPageOutput extends BasePngPageOutput {
    kind: 'metadata';
    content: undefined;
    path: '';
}

export interface InMemoryPngPageOutput extends BasePngPageOutput {
    kind: 'content';
    content: Buffer | undefined;
    path: '';
}

export interface FilePngPageOutput extends BasePngPageOutput {
    kind: 'file';
    content: Buffer | undefined;
    path: string;
}

export type PngPageOutput = MetadataPngPageOutput | InMemoryPngPageOutput | FilePngPageOutput;
