import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "../types";
import {
  closeProjectSession,
  closeSessionFile,
  createProjectSession,
  openSessionFile,
  upsertProjectSession,
} from "./projectSessions";

const project = (root: string, rootDocument = "main.tex"): ProjectSnapshot => ({
  root,
  name: root.slice(1),
  rootDocument,
  files: [
    { path: rootDocument, name: rootDocument, kind: "tex" },
    { path: "chapter.tex", name: "chapter.tex", kind: "tex" },
    { path: "references.bib", name: "references.bib", kind: "bib" },
  ],
});

describe("project sessions", () => {
  it("starts each project with its root document open", () => {
    expect(createProjectSession(project("/one"))).toMatchObject({
      activePath: "main.tex",
      openPaths: ["main.tex"],
    });
  });

  it("adds projects and activates an existing project without duplicating it", () => {
    const one = createProjectSession(project("/one"));
    const added = upsertProjectSession([one], project("/two"));
    expect(added.map((session) => session.project.root)).toEqual(["/one", "/two"]);

    const refreshed = upsertProjectSession(added, { ...project("/one"), name: "Renamed" }, "chapter.tex");
    expect(refreshed).toHaveLength(2);
    expect(refreshed[0]).toMatchObject({ activePath: "chapter.tex", openPaths: ["main.tex", "chapter.tex"] });
    expect(refreshed[0].project.name).toBe("Renamed");
  });

  it("opens each file once and preserves the other project sessions", () => {
    const sessions = [createProjectSession(project("/one")), createProjectSession(project("/two"))];
    const opened = openSessionFile(openSessionFile(sessions, "/one", "chapter.tex"), "/one", "chapter.tex");
    expect(opened[0].openPaths).toEqual(["main.tex", "chapter.tex"]);
    expect(opened[0].activePath).toBe("chapter.tex");
    expect(opened[1]).toBe(sessions[1]);
  });

  it("closes active, inactive, missing, and final file tabs safely", () => {
    const opened = openSessionFile(
      openSessionFile([createProjectSession(project("/one"))], "/one", "chapter.tex"),
      "/one",
      "references.bib",
    );
    const inactive = closeSessionFile(opened, "/one", "chapter.tex");
    expect(inactive.sessions[0]).toMatchObject({ activePath: "references.bib", openPaths: ["main.tex", "references.bib"] });

    const active = closeSessionFile(inactive.sessions, "/one", "references.bib");
    expect(active).toMatchObject({ nextPath: "main.tex" });
    expect(active.sessions[0].openPaths).toEqual(["main.tex"]);
    expect(closeSessionFile(active.sessions, "/one", "main.tex").sessions).toBe(active.sessions);
    expect(closeSessionFile(active.sessions, "/one", "missing.tex").sessions).toBe(active.sessions);
  });

  it("closes project tabs and selects a stable neighboring project", () => {
    const sessions = ["/one", "/two", "/three"].map((root) => createProjectSession(project(root)));
    expect(closeProjectSession(sessions, "/two").nextRoot).toBe("/three");
    expect(closeProjectSession(sessions, "/three").nextRoot).toBe("/two");
    expect(closeProjectSession([sessions[0]], "/one").sessions).toEqual([sessions[0]]);
    expect(closeProjectSession(sessions, "/missing").sessions).toBe(sessions);
  });
});
