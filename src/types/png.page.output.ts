/** Represents the rendered output for a single PDF page. */
export type PngPageOutput = {
    /** 1-based page number within the source PDF. */
    pageNumber: number;

    /** Output filename, e.g. `"document_page_1.png"`. Does not include the folder path. */
    name: string;

    /**
     * PNG image data. Present when `PdfToPngOptions.returnPageContent` is `true` (the default).
     * Undefined when `returnPageContent` is `false`.
     */
    content?: Buffer;

    /**
     * Absolute or relative path to the written PNG file.
     * Populated only when `PdfToPngOptions.outputFolder` is specified; otherwise an empty string.
     */
    path: string;

    /** Width of the rendered image in pixels, determined by the page viewport and `viewportScale`. */
    width: number;

    /** Height of the rendered image in pixels, determined by the page viewport and `viewportScale`. */
    height: number;
};
