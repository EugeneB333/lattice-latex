import type { ProjectSnapshot } from "./types";
import starterSource from "../assets/starter.tex?raw";

export const demoSource = starterSource;

export const demoProject: ProjectSnapshot = {
  root: "demo://reliable-documents",
  name: "reliable-documents",
  rootDocument: "main.tex",
  files: [
    { path: "main.tex", name: "main.tex", kind: "tex" },
    { path: "references.bib", name: "references.bib", kind: "bib" },
    { path: "figures/results.pdf", name: "results.pdf", kind: "image" },
  ],
};
