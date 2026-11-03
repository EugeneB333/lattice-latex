import { describe, expect, it } from "vitest";
import { pdfPointFromClient } from "./synctex";

describe("SyncTeX coordinate conversion", () => {
  it("converts a scaled canvas click to PDF points", () => {
    expect(pdfPointFromClient(250, 340, { left: 10, top: 40 }, 1.5)).toEqual({
      x: 160,
      y: 200,
    });
  });

  it("clamps clicks at the canvas edge", () => {
    expect(pdfPointFromClient(5, 8, { left: 10, top: 10 }, 1)).toEqual({ x: 0, y: 0 });
  });

  it("supports fractional zoom and coordinates", () => {
    expect(pdfPointFromClient(11, 17, { left: 1, top: 2 }, 0.5)).toEqual({ x: 20, y: 30 });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid scale %s", (scale) => {
    expect(() => pdfPointFromClient(1, 1, { left: 0, top: 0 }, scale)).toThrow("PDF scale must be positive");
  });
});
