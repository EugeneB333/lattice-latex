import { describe, expect, it } from "vitest";
import { loadRecentProjects, recentProjectsFromStorage, rememberRecentProject, storeRecentProjects } from "./recentProjects";

describe("recent projects", () => {
  it("keeps the most recent project first without duplicates", () => {
    const recent = [
      { root: "/one", name: "One" },
      { root: "/two", name: "Two" },
    ];
    expect(rememberRecentProject(recent, { root: "/two", name: "Two renamed" })).toEqual([
      { root: "/two", name: "Two renamed" },
      { root: "/one", name: "One" },
    ]);
  });

  it("limits stored projects to ten and ignores malformed data", () => {
    const stored = JSON.stringify(Array.from({ length: 12 }, (_, index) => ({
      root: `/project-${index}`,
      name: `Project ${index}`,
    })));
    expect(recentProjectsFromStorage(stored)).toHaveLength(10);
    expect(recentProjectsFromStorage("not json")).toEqual([]);
    expect(recentProjectsFromStorage(JSON.stringify([{ root: 42, name: "Bad" }]))).toEqual([]);
  });

  it("deduplicates stored roots while preserving the first occurrence", () => {
    expect(recentProjectsFromStorage(JSON.stringify([
      { root: "/same", name: "Newest" },
      { root: "/same", name: "Old" },
      { root: "", name: "Empty root" },
      null,
    ]))).toEqual([{ root: "/same", name: "Newest" }]);
  });

  it("moves a project to the front and caps remembered entries", () => {
    const recent = Array.from({ length: 10 }, (_, index) => ({ root: `/${index}`, name: String(index) }));
    expect(rememberRecentProject(recent, { root: "/new", name: "New" })).toHaveLength(10);
    expect(rememberRecentProject(recent, { root: "/5", name: "Renamed" })[0]).toEqual({ root: "/5", name: "Renamed" });
  });

  it("loads and stores browser recents through localStorage", () => {
    const storage = new Map<string, string>();
    const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) };
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
    const recent = Array.from({ length: 12 }, (_, index) => ({ root: `/${index}`, name: String(index) }));
    storeRecentProjects(recent);
    expect(loadRecentProjects()).toEqual(recent.slice(0, 10));
  });
});
