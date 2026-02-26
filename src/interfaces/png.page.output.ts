/** Represents the rendered output for a single PDF page. */
export interface PngPageOutput {
    /** 1-based page number within the source PDF. */
    pageNumber: number;

    /** Output filename, e.g. `"document_page_1.png"`. Does not include the folder path. */
    name: string;

    /**
     * PNG image data as a `Buffer`.
     * Present when `PdfToPngOptions.returnPageContent` is `true` (the default).
     * `undefined` when `returnPageContent` is `false`, when `returnMetadataOnly` is `true`,
     * or after the content has been freed from memory following a disk write with `returnPageContent: false`.
     */
    content?: Buffer;

    /**
     * Absolute path to the written PNG file.
     * Populated only when `PdfToPngOptions.outputFolder` is specified and `returnMetadataOnly` is `false`;
     * otherwise an empty string `""`.
     */
    path: string;

    /** Width of the rendered image in pixels, determined by the page viewport and `viewportScale`. */
    width: number;

    /** Height of the rendered image in pixels, determined by the page viewport and `viewportScale`. */
    height: number;

    /**
     * Intrinsic page rotation in degrees as stored in the PDF.
     * Possible values: `0`, `90`, `180`, `270`.
     * Taken from `PDFPageProxy.rotate` — always populated, including when `returnMetadataOnly` is `true`.
     */
    rotation: number;
}
