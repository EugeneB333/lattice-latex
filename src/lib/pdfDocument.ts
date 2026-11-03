import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export interface PdfRenderTask {
  readonly promise: Promise<void>;
  cancel(): void;
}

export interface PdfPageHandle {
  links: readonly PdfInternalLink[];
  size(): { width: number; height: number };
  render(canvas: HTMLCanvasElement, scale: number): PdfRenderTask;
}

export interface PdfInternalLink {
  /** Rectangle in the same unscaled, top-left viewport coordinates as preview clicks. */
  rect: [number, number, number, number];
  destination: string | unknown[];
}

export interface PdfLocation {
  page: number;
  x: number;
  y: number;
}

export interface PdfDocumentHandle {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPageHandle>;
  resolveDestination(destination: PdfInternalLink["destination"]): Promise<PdfLocation | undefined>;
  destroy(): void;
}

class PdfJsPageHandle implements PdfPageHandle {
  constructor(private readonly page: PDFPageProxy, public readonly links: PdfInternalLink[]) {}

  size() {
    const viewport = this.page.getViewport({ scale: 1 });
    return { width: viewport.width, height: viewport.height };
  }

  render(canvas: HTMLCanvasElement, scale: number) {
    const viewport = this.page.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    return this.page.render({ canvas, viewport });
  }
}

class PdfJsDocumentHandle implements PdfDocumentHandle {
  constructor(
    private readonly document: PDFDocumentProxy,
    private readonly loadingTask: PDFDocumentLoadingTask,
  ) {}

  get numPages() {
    return this.document.numPages;
  }

  async getPage(pageNumber: number) {
    const page = await this.document.getPage(pageNumber);
    const links: PdfInternalLink[] = [];
    try {
      const viewport = page.getViewport({ scale: 1 });
      for (const annotation of await page.getAnnotations({ intent: "display" })) {
        // Only local GoTo links are useful here. Never follow URLs, remote PDFs, or actions.
        if (annotation.subtype !== "Link" || annotation.url || annotation.unsafeUrl || annotation.action) continue;
        if (!(typeof annotation.dest === "string" && annotation.dest.length > 0) && !Array.isArray(annotation.dest)) continue;
        if (!Array.isArray(annotation.rect) || annotation.rect.length !== 4 || !annotation.rect.every(Number.isFinite)) continue;
        const [x1, y1] = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]);
        const [x2, y2] = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
        links.push({
          rect: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)],
          destination: annotation.dest,
        });
      }
    } catch {
      // Annotation failures must not prevent rendering or ordinary SyncTeX navigation.
    }
    return new PdfJsPageHandle(page, links);
  }

  async resolveDestination(destination: PdfInternalLink["destination"]): Promise<PdfLocation | undefined> {
    const explicit = typeof destination === "string" ? await this.document.getDestination(destination) : destination;
    if (!Array.isArray(explicit) || explicit.length < 2) return undefined;
    const [reference, mode] = explicit;
    let index: number;
    if (typeof reference === "number") index = reference;
    else if (reference && typeof reference === "object" && Number.isInteger(reference.num) && Number.isInteger(reference.gen)) {
      index = await this.document.getPageIndex(reference);
    } else return undefined;
    if (!Number.isInteger(index) || index < 0 || index >= this.numPages) return undefined;

    const page = await this.document.getPage(index + 1);
    const [left, , , top] = page.view;
    let x = left;
    let y = top;
    const coordinate = (value: unknown) => value === null || (typeof value === "number" && Number.isFinite(value));
    switch (mode?.name) {
      case "XYZ":
        if (!coordinate(explicit[2]) || !coordinate(explicit[3])) return undefined;
        x = explicit[2] ?? left;
        y = explicit[3] ?? top;
        break;
      case "FitH":
      case "FitBH":
        if (!coordinate(explicit[2])) return undefined;
        y = explicit[2] ?? top;
        break;
      case "FitV":
      case "FitBV":
        if (!coordinate(explicit[2])) return undefined;
        x = explicit[2] ?? left;
        break;
      case "FitR":
        if (explicit.length < 6 || !explicit.slice(2, 6).every(Number.isFinite)) return undefined;
        x = Math.min(explicit[2], explicit[4]);
        y = Math.max(explicit[3], explicit[5]);
        break;
      case "Fit":
      case "FitB":
        break;
      default:
        return undefined;
    }
    const [viewportX, viewportY] = page.getViewport({ scale: 1 }).convertToViewportPoint(x, y);
    if (!Number.isFinite(viewportX) || !Number.isFinite(viewportY)) return undefined;
    return { page: index + 1, x: Math.max(0, viewportX), y: Math.max(0, viewportY) };
  }

  destroy() {
    void this.loadingTask.destroy();
  }
}

function decodeBase64(value: string) {
  const decoded = window.atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

export async function loadPdfDocument(pdfBase64: string): Promise<PdfDocumentHandle> {
  const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = worker.default;
  const loadingTask = getDocument({ data: decodeBase64(pdfBase64) });
  const document = await loadingTask.promise;
  return new PdfJsDocumentHandle(document, loadingTask);
}
