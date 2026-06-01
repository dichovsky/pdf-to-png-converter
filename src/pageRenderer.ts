import type { PDFDocumentProxy } from 'pdfjs-dist';
import { MAX_CANVAS_PIXELS } from './const.js';
import type { InMemoryPngPageOutput, MetadataPngPageOutput, PageRotation } from './interfaces/index.js';
import { NodeCanvasFactory } from './node.canvas.factory.js';

function isNodeCanvasFactory(factory: unknown): factory is NodeCanvasFactory {
    return typeof factory === 'object' && factory !== null && 'create' in factory && typeof factory.create === 'function';
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
        throw new Error(
            `Canvas ${Math.round(viewport.width)}×${Math.round(viewport.height)} px exceeds the ${MAX_CANVAS_PIXELS.toLocaleString()} pixel limit. Reduce viewportScale.`,
        );
    }

    const canvasWidth = toPixelDimension(viewport.width);
    const canvasHeight = toPixelDimension(viewport.height);
    if (canvasWidth <= 0 || canvasHeight <= 0) {
        page.cleanup();
        throw nonRenderableDimensionsError(canvasWidth, canvasHeight);
    }

    const canvasFactory = isNodeCanvasFactory(pdf.canvasFactory) ? pdf.canvasFactory : new NodeCanvasFactory();
    const { canvas, context } = canvasFactory.create(canvasWidth, canvasHeight);

    try {
        if (!canvas) {
            throw new Error('NodeCanvasFactory.create returned a null canvas');
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
        if (canvas) {
            canvasFactory.destroy({ canvas, context });
        }
    }
}
