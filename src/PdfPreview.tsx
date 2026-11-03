import { useEffect, useRef, useState, type MouseEvent } from "react";
import { loadPdfDocument, type PdfDocumentHandle, type PdfPageHandle } from "./lib/pdfDocument";
import { pdfPointFromClient } from "./lib/synctex";
import type { SyncTexPdfPosition } from "./types";

interface LoadedPage {
  page: PdfPageHandle;
  widthPoints: number;
  heightPoints: number;
}

// A one-pixel-per-point canvas makes TeX's thin serif strokes look rough on
// ordinary 1x desktop displays. Render at least 2x and let the browser
// downsample to the unchanged CSS page size; high-DPI displays keep their
// native device ratio.
const MINIMUM_RENDER_PIXEL_RATIO = 2;

function PdfCanvasPage({
  page,
  pageNumber,
  scale,
  target,
  onNavigate,
  onEditTable,
  loadPageImage,
}: {
  page: LoadedPage;
  pageNumber: number;
  scale: number;
  target?: SyncTexPdfPosition;
  onNavigate: (page: number, x: number, y: number) => void;
  onEditTable: (page: number, x: number, y: number) => void;
  loadPageImage?: (page: number) => Promise<string>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shouldRender, setShouldRender] = useState(() => typeof window.IntersectionObserver === "undefined");
  const [renderError, setRenderError] = useState<string>();
  const [pageImage, setPageImage] = useState<string>();

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window.IntersectionObserver === "undefined") return;
    const observer = new window.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setShouldRender(true);
    }, {
      root: root.closest(".preview-canvas"),
      rootMargin: "1200px 0px",
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setPageImage(undefined);
    if (!loadPageImage || !shouldRender) return;
    setRenderError(undefined);
    let active = true;
    void loadPageImage(pageNumber).then((svgBase64) => {
      if (active) setPageImage(`data:image/svg+xml;base64,${svgBase64}`);
    }).catch((error) => {
      if (active) setRenderError(String(error));
    });
    return () => { active = false; };
  }, [loadPageImage, pageNumber, shouldRender]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (loadPageImage || !canvas || !shouldRender) return;
    setRenderError(undefined);
    let cancelled = false;
    let task: ReturnType<PdfPageHandle["render"]> | undefined;
    try {
      const pixelRatio = Math.max(MINIMUM_RENDER_PIXEL_RATIO, window.devicePixelRatio || 1);
      task = page.page.render(canvas, scale * pixelRatio);
      void task.promise.catch((error) => {
        if (!cancelled && (error as { name?: string }).name !== "RenderingCancelledException") {
          setRenderError(String(error));
        }
      });
    } catch (error) {
      setRenderError(String(error));
    }
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [loadPageImage, page, scale, shouldRender]);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!event.shiftKey && !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const point = pdfPointFromClient(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), scale);
    if (event.shiftKey) onEditTable(pageNumber, point.x, point.y);
    else onNavigate(pageNumber, point.x, point.y);
  };

  return (
    <div
      ref={rootRef}
      className="pdf-page"
      data-page-number={pageNumber}
      style={{ width: page.widthPoints * scale, height: page.heightPoints * scale }}
      onClick={handleClick}
      title="Ctrl/Cmd+click to jump to source; Shift+click to edit a table"
    >
      {loadPageImage ? (
        pageImage && (
          <img
            src={pageImage}
            style={{ width: page.widthPoints * scale, height: page.heightPoints * scale }}
            aria-label={`PDF page ${pageNumber}`}
          />
        )
      ) : (
        <canvas
          ref={canvasRef}
          style={{ width: page.widthPoints * scale, height: page.heightPoints * scale }}
          aria-label={`PDF page ${pageNumber}`}
        />
      )}
      {renderError && <span className="pdf-page-error">Could not render page {pageNumber}</span>}
      {target?.page === pageNumber && (
        <span
          className="synctex-target"
          style={{
            left: target.x * scale,
            top: target.y * scale,
            width: Math.max(Math.abs(target.width) * scale, 12),
            height: Math.max(Math.abs(target.height) * scale, 12),
          }}
        />
      )}
      <span className="pdf-page-number">{pageNumber}</span>
    </div>
  );
}

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; document: PdfDocumentHandle; pages: LoadedPage[] }
  | { status: "error"; message: string };

export function PdfPreview({
  pdfBase64,
  zoom,
  target,
  onNavigate,
  onEditTable,
  loadPageImage,
}: {
  pdfBase64: string;
  zoom: number;
  target?: SyncTexPdfPosition;
  onNavigate: (page: number, x: number, y: number) => void;
  onEditTable: (page: number, x: number, y: number) => void;
  loadPageImage?: (page: number) => Promise<string>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const navigationRequest = useRef(0);
  const scale = zoom / 100;

  useEffect(() => {
    let active = true;
    let loadedDocument: PdfDocumentHandle | undefined;
    setState({ status: "loading" });
    void loadPdfDocument(pdfBase64).then(async (document) => {
      loadedDocument = document;
      if (!active) {
        document.destroy();
        return;
      }
      const pageHandles = await Promise.all(
        Array.from({ length: document.numPages }, (_, index) => document.getPage(index + 1)),
      );
      if (!active) return;
      setState({
        status: "ready",
        document,
        pages: pageHandles.map((page) => {
          const size = page.size();
          return { page, widthPoints: size.width, heightPoints: size.height };
        }),
      });
    }).catch((error) => {
      if (active) setState({ status: "error", message: String(error) });
    });
    return () => {
      active = false;
      navigationRequest.current += 1;
      loadedDocument?.destroy();
    };
  }, [pdfBase64]);

  const navigateFromPdf = (pageNumber: number, x: number, y: number) => {
    const request = ++navigationRequest.current;
    if (state.status !== "ready") return;
    const link = state.pages[pageNumber - 1].page.links.find(({ rect: [left, top, right, bottom] }) =>
      x >= left && x <= right && y >= top && y <= bottom,
    );
    if (!link) {
      onNavigate(pageNumber, x, y);
      return;
    }
    void state.document.resolveDestination(link.destination).catch(() => undefined).then((destination) => {
      if (request !== navigationRequest.current) return;
      const position = destination ?? { page: pageNumber, x, y };
      onNavigate(position.page, position.x, position.y);
    });
  };

  useEffect(() => {
    if (!target || state.status !== "ready" || !rootRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const page = rootRef.current?.querySelector<HTMLElement>(`[data-page-number="${target.page}"]`);
      const scroller = rootRef.current?.closest<HTMLElement>(".preview-canvas");
      if (!page || !scroller) return;
      scroller.scrollTo({
        top: Math.max(0, page.offsetTop + target.y * scale - scroller.clientHeight / 2),
        left: Math.max(0, page.offsetLeft + target.x * scale - scroller.clientWidth / 2),
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scale, state, target]);

  if (state.status === "loading") {
    return <div className="preview-message">Preparing PDF preview…</div>;
  }
  if (state.status === "error") {
    return <div className="preview-error">The PDF built successfully, but the preview could not be loaded: {state.message}</div>;
  }

  return (
    <div className="pdf-document" ref={rootRef}>
      {state.pages.map((page, index) => (
        <PdfCanvasPage
          key={index + 1}
          page={page}
          pageNumber={index + 1}
          scale={scale}
          target={target}
          onNavigate={navigateFromPdf}
          onEditTable={onEditTable}
          loadPageImage={loadPageImage}
        />
      ))}
    </div>
  );
}
