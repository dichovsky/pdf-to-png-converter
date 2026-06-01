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

/**
 * Converts a (possibly fractional) viewport length into the integer pixel count the canvas
 * will actually allocate. `@napi-rs/canvas` truncates fractional dimensions toward zero when a
 * canvas is constructed (e.g. a 892.5-wide viewport yields an 892 px bitmap), so the reported
 * `width`/`height` must be floored to match the rendered PNG. Viewport lengths are always
 * non-negative, so `Math.floor` is equivalent to that truncation. Flooring here keeps the
 * render path and the `returnMetadataOnly` path reporting identical, image-accurate pixel sizes.
 *
 * @internal Exported for unit testing only; not part of the public API (`src/index.ts`).
 */
export function toPixelDimension(viewportLength: number): number {
    return Math.floor(viewportLength);
}

/**
 * Builds the error thrown when floored page dimensions collapse to a non-renderable size.
 *
 * A very small `viewportScale` (e.g. `0.001` on a 612 pt page) floors to `0` px. A 0-wide or
 * 0-tall bitmap cannot be rendered, so both the render and `returnMetadataOnly` paths reject it
 * with this identical, actionable message instead of either returning a phantom `0×0` metadata
 * result or surfacing an opaque canvas-factory `AssertionError`.
 *
 * @internal
 */
export function nonRenderableDimensionsError(width: number, height: number): Error {
    return new Error(
        `Page dimensions floor to ${width}×${height} px at this viewportScale, which cannot produce a valid image. Increase viewportScale.`,
    );
}

/**
 * Builds the error thrown when a page's viewport area exceeds `MAX_CANVAS_PIXELS`.
 *
 * A page this large cannot be rendered: `renderPdfPage` rejects it before allocating a canvas to
 * avoid OOM. The `returnMetadataOnly` path shares this guard so it reports the same outcome a render
 * would — rejecting an unrenderable page rather than returning phantom dimensions for it. Mirrors
 * {@link nonRenderableDimensionsError}, which keeps the two paths symmetric on the lower bound.
 *
 * @internal
 */
export function canvasPixelLimitError(viewportWidth: number, viewportHeight: number): Error {
    // Pin the locale so the thousands separator is stable across runtimes (an unqualified
    // toLocaleString() varies — comma, space, or narrow no-break space — yielding inconsistent
    // user-facing output and brittle assertions).
    return new Error(
        `Canvas ${Math.round(viewportWidth)}×${Math.round(viewportHeight)} px exceeds the ${MAX_CANVAS_PIXELS.toLocaleString('en-US')} pixel limit. Reduce viewportScale.`,
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
        if (viewport.width * viewport.height > MAX_CANVAS_PIXELS) {
            throw canvasPixelLimitError(viewport.width, viewport.height);
        }
        const width = toPixelDimension(viewport.width);
        const height = toPixelDimension(viewport.height);
        if (width <= 0 || height <= 0) {
            throw nonRenderableDimensionsError(width, height);
        }
        return {
            kind: 'metadata',
            pageNumber,
            name: pageName,
            content: undefined,
            path: '',
            width,
            height,
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
        throw canvasPixelLimitError(viewport.width, viewport.height);
    }

    const canvasWidth = toPixelDimension(viewport.width);
    const canvasHeight = toPixelDimension(viewport.height);
    if (canvasWidth <= 0 || canvasHeight <= 0) {
        page.cleanup();
        throw nonRenderableDimensionsError(canvasWidth, canvasHeight);
    }

    const canvasFactory = pdf.canvasFactory;
    if (!isCanvasFactory(canvasFactory)) {
        page.cleanup();
        throw new Error('pdf.js did not provide a usable canvas factory (missing create/destroy).');
    }

    const canvasAndContext = canvasFactory.create(canvasWidth, canvasHeight);
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
            width: canvasWidth,
            height: canvasHeight,
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
