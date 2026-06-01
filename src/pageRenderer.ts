import type { PDFDocumentProxy } from 'pdfjs-dist';
import { MAX_CANVAS_PIXELS } from './const.js';
import type { CanvasAndContext, InMemoryPngPageOutput, MetadataPngPageOutput, PageRotation } from './interfaces/index.js';

/**
 * Minimal structural contract for the canvas factory pdf.js installs on each document.
 *
 * pdf.js types `PDFDocumentProxy.canvasFactory` as `Object`, so we describe only the
 * `create` / `destroy` slice we use. At runtime this is pdf.js's built-in Node canvas factory,
 * which is backed by `@napi-rs/canvas` (pdf.js's own optional dependency, kept as a direct
 * dependency of this package so it is always present). The produced `Canvas` therefore exposes
 * `toBuffer('image/png')`.
 */
interface CanvasFactory {
    create(width: number, height: number): CanvasAndContext;
    destroy(canvasAndContext: CanvasAndContext): void;
}

/**
 * Runtime structural check that pdf.js's `canvasFactory` exposes the `create` / `destroy` slice
 * we rely on. pdf.js types the property as `Object`, so the value is validated at runtime rather
 * than force-cast — a missing or malformed factory then fails fast with a clear message instead of
 * surfacing a `TypeError` deep inside the render path.
 */
function isCanvasFactory(factory: unknown): factory is CanvasFactory {
    return (
        typeof factory === 'object' &&
        factory !== null &&
        'create' in factory &&
        typeof factory.create === 'function' &&
        'destroy' in factory &&
        typeof factory.destroy === 'function'
    );
}

export function normalizeRotation(raw: number): PageRotation {
    const normalized = ((raw % 360) + 360) % 360;
    switch (normalized) {
        case 0:
            return 0;
        case 90:
            return 90;
        case 180:
            return 180;
        case 270:
            return 270;
        default:
            throw new Error(`Unsupported PDF page rotation: ${raw}`);
    }
}

export async function getPageMetadata(
    pdf: PDFDocumentProxy,
    pageName: string,
    pageNumber: number,
    pageViewportScale: number,
): Promise<MetadataPngPageOutput> {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: pageViewportScale });

    try {
        return {
            kind: 'metadata',
            pageNumber,
            name: pageName,
            content: undefined,
            path: '',
            width: viewport.width,
            height: viewport.height,
            rotation: normalizeRotation(page.rotate),
        };
    } finally {
        page.cleanup();
    }
}

export async function renderPdfPage(
    pdf: PDFDocumentProxy,
    pageName: string,
    pageNumber: number,
    pageViewportScale: number,
    returnPageContent: boolean,
): Promise<InMemoryPngPageOutput> {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: pageViewportScale });

    if (viewport.width * viewport.height > MAX_CANVAS_PIXELS) {
        page.cleanup();
        throw new Error(
            `Canvas ${Math.round(viewport.width)}×${Math.round(viewport.height)} px exceeds the ${MAX_CANVAS_PIXELS.toLocaleString()} pixel limit. Reduce viewportScale.`,
        );
    }

    const canvasFactory = pdf.canvasFactory;
    if (!isCanvasFactory(canvasFactory)) {
        page.cleanup();
        throw new Error('pdf.js did not provide a usable canvas factory (missing create/destroy).');
    }

    const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
    const { canvas, context } = canvasAndContext;

    try {
        if (!canvas || !context) {
            throw new Error('pdf.js canvas factory returned a null canvas or context.');
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — upstream pdfjs-dist@~6.0.x expects DOM CanvasRenderingContext2D, but @napi-rs/canvas exposes SKRSContext2D here. @ts-ignore (not @ts-expect-error) is required because build:test runs with skipLibCheck:true, which hides this error and would make @ts-expect-error report as unused.
        await page.render({ canvasContext: context, viewport, canvas }).promise;
        return {
            kind: 'content',
            pageNumber,
            name: pageName,
            content: returnPageContent ? canvas.toBuffer('image/png') : undefined,
            path: '',
            width: viewport.width,
            height: viewport.height,
            rotation: normalizeRotation(page.rotate),
        };
    } finally {
        page.cleanup();
        // Pass the original object pdf.js handed back so any internal fields it needs for cleanup
        // survive. Guard on canvas: pdf.js's destroy() asserts a non-null canvas, so skip it when
        // create() yielded none (the try block has already thrown for that case).
        if (canvasAndContext.canvas) {
            canvasFactory.destroy(canvasAndContext);
        }
    }
}
