export interface ClientRectOrigin {
  left: number;
  top: number;
}

export function pdfPointFromClient(
  clientX: number,
  clientY: number,
  rect: ClientRectOrigin,
  scale: number,
) {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("PDF scale must be positive");
  return {
    x: Math.max(0, (clientX - rect.left) / scale),
    y: Math.max(0, (clientY - rect.top) / scale),
  };
}
