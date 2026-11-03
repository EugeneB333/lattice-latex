// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "../types";
import { createProjectSession } from "./projectSessions";
import {
  loadWorkspaceSession,
  reconcileStoredProjectSession,
  storeWorkspaceSession,
  workspaceSessionFromStorage,
} from "./workspaceSession";

const project: ProjectSnapshot = {
  root: "/paper",
  name: "paper",
  rootDocument: "main.tex",
  files: [
    { path: "main.tex", name: "main.tex", kind: "tex" },
    { path: "chapters/one.tex", name: "one.tex", kind: "tex" },
    { path: "references.bib", name: "references.bib", kind: "bib" },
    { path: "figure.pdf", name: "figure.pdf", kind: "image" },
  ],
};

beforeEach(() => window.localStorage.clear());

describe("workspace session persistence", () => {
  it("parses valid sessions, removes duplicates, and repairs an invalid active root", () => {
    const stored = workspaceSessionFromStorage(JSON.stringify({
      version: 1,
      activeRoot: "/missing",
      projects: [
        { root: "/one", openPaths: ["main.tex", "main.tex", "chapter.tex"], activePath: "chapter.tex" },
        { root: "/one", openPaths: ["duplicate.tex"], activePath: "duplicate.tex" },
        { root: "/two", openPaths: ["paper.tex"], activePath: "paper.tex" },
      ],
    }));
    expect(stored).toEqual({
      version: 1,
      activeRoot: "/one",
      projects: [
        { root: "/one", openPaths: ["main.tex", "chapter.tex"], activePath: "chapter.tex" },
        { root: "/two", openPaths: ["paper.tex"], activePath: "paper.tex" },
      ],
    });
  });

  it.each([
    null,
    "",
    "not json",
    JSON.stringify([]),
    JSON.stringify({ version: 2, activeRoot: "/one", projects: [] }),
    JSON.stringify({ version: 1, activeRoot: "/one", projects: "bad" }),
    JSON.stringify({ version: 1, activeRoot: "/one", projects: [{ root: "/one", openPaths: [], activePath: "main.tex" }] }),
  ])("rejects missing, malformed, outdated, and empty storage", (raw) => {
    expect(workspaceSessionFromStorage(raw)).toBeUndefined();
  });

  it("adds a valid active file omitted from the stored open-file list", () => {
    expect(workspaceSessionFromStorage(JSON.stringify({
      version: 1,
      activeRoot: "/one",
      projects: [{ root: "/one", openPaths: ["main.tex"], activePath: "chapter.tex" }],
    }))?.projects[0].openPaths).toEqual(["main.tex", "chapter.tex"]);
  });

  it("stores and loads only session metadata", () => {
    const one = { ...createProjectSession(project), openPaths: ["main.tex", "references.bib"], activePath: "references.bib" };
    const twoProject = { ...project, root: "/other", name: "other" };
    storeWorkspaceSession([one, createProjectSession(twoProject)], "/other");
    expect(loadWorkspaceSession()).toEqual({
      version: 1,
      activeRoot: "/other",
      projects: [
        { root: "/paper", openPaths: ["main.tex", "references.bib"], activePath: "references.bib" },
        { root: "/other", openPaths: ["main.tex"], activePath: "main.tex" },
      ],
    });
  });

  it("keeps the active file when an oversized or empty open-file list is normalized", () => {
    const oversized = {
      ...createProjectSession(project),
      openPaths: Array.from({ length: 201 }, (_, index) => `chapter-${index}.tex`),
      activePath: "active.tex",
    };
    const empty = { ...createProjectSession({ ...project, root: "/empty" }), openPaths: [], activePath: "main.tex" };
    storeWorkspaceSession([oversized, empty], project.root);
    const loaded = loadWorkspaceSession();
    expect(loaded?.projects[0].openPaths).toHaveLength(200);
    expect(loaded?.projects[0].openPaths).toContain("active.tex");
    expect(loaded?.projects[1].openPaths).toEqual(["main.tex"]);
  });

  it("reconciles renamed, deleted, and non-editable files against a fresh project snapshot", () => {
    expect(reconcileStoredProjectSession(project, {
      root: project.root,
      openPaths: ["chapters/one.tex", "deleted.tex", "figure.pdf", "references.bib"],
      activePath: "deleted.tex",
    })).toMatchObject({
      openPaths: ["chapters/one.tex", "references.bib"],
      activePath: "chapters/one.tex",
    });
  });

  it("falls back to the current root document when every stored file disappeared", () => {
    expect(reconcileStoredProjectSession(project, {
      root: project.root,
      openPaths: ["deleted.tex"],
      activePath: "deleted.tex",
    })).toMatchObject({ openPaths: ["main.tex"], activePath: "main.tex" });
  });
});
