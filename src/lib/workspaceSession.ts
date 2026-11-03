import type { ProjectSnapshot } from "../types";
import type { ProjectSession } from "./projectSessions";

const STORAGE_KEY = "lattice-workspace-session";
const STORAGE_VERSION = 1;
const MAX_PROJECTS = 50;
const MAX_FILES_PER_PROJECT = 200;
const MAX_PATH_LENGTH = 4096;

export interface StoredProjectSession {
  root: string;
  openPaths: string[];
  activePath: string;
}

export interface StoredWorkspaceSession {
  version: 1;
  activeRoot: string;
  projects: StoredProjectSession[];
}

function validPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_PATH_LENGTH && !value.includes("\0");
}

export function workspaceSessionFromStorage(raw: string | null): StoredWorkspaceSession | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== STORAGE_VERSION) return undefined;
    const input = parsed as { activeRoot?: unknown; projects?: unknown };
    if (!Array.isArray(input.projects)) return undefined;
    const seenRoots = new Set<string>();
    const projects: StoredProjectSession[] = [];
    for (const candidate of input.projects) {
      if (projects.length >= MAX_PROJECTS) break;
      if (!candidate || typeof candidate !== "object") continue;
      const value = candidate as { root?: unknown; openPaths?: unknown; activePath?: unknown };
      if (!validPath(value.root) || seenRoots.has(value.root) || !Array.isArray(value.openPaths)) continue;
      const seenPaths = new Set<string>();
      const openPaths = value.openPaths
        .filter(validPath)
        .filter((path) => {
          if (seenPaths.has(path)) return false;
          seenPaths.add(path);
          return true;
        })
        .slice(0, MAX_FILES_PER_PROJECT);
      if (!openPaths.length || !validPath(value.activePath)) continue;
      if (!openPaths.includes(value.activePath)) {
        if (openPaths.length >= MAX_FILES_PER_PROJECT) openPaths[openPaths.length - 1] = value.activePath;
        else openPaths.push(value.activePath);
      }
      seenRoots.add(value.root);
      projects.push({ root: value.root, openPaths, activePath: value.activePath });
    }
    if (!projects.length) return undefined;
    const activeRoot = validPath(input.activeRoot) && projects.some((project) => project.root === input.activeRoot)
      ? input.activeRoot
      : projects[0].root;
    return { version: STORAGE_VERSION, activeRoot, projects };
  } catch {
    return undefined;
  }
}

export function loadWorkspaceSession(): StoredWorkspaceSession | undefined {
  if (typeof window === "undefined") return undefined;
  return workspaceSessionFromStorage(window.localStorage.getItem(STORAGE_KEY));
}

export function storeWorkspaceSession(sessions: ProjectSession[], activeRoot: string): void {
  if (typeof window === "undefined" || !sessions.length) return;
  const projects = sessions.slice(0, MAX_PROJECTS).map((session) => {
    const openPaths = session.openPaths.slice(0, MAX_FILES_PER_PROJECT);
    if (!openPaths.includes(session.activePath)) {
      if (openPaths.length) openPaths[openPaths.length - 1] = session.activePath;
      else openPaths.push(session.activePath);
    }
    return {
      root: session.project.root,
      openPaths,
      activePath: session.activePath,
    };
  });
  const resolvedActiveRoot = projects.some((project) => project.root === activeRoot)
    ? activeRoot
    : projects[0].root;
  const stored: StoredWorkspaceSession = {
    version: STORAGE_VERSION,
    activeRoot: resolvedActiveRoot,
    projects,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function reconcileStoredProjectSession(
  project: ProjectSnapshot,
  stored: StoredProjectSession,
): ProjectSession {
  const editablePaths = new Set(
    project.files.filter((file) => file.kind !== "image").map((file) => file.path),
  );
  const openPaths = stored.openPaths.filter((path) => editablePaths.has(path));
  if (!openPaths.length) openPaths.push(project.rootDocument);
  const activePath = openPaths.includes(stored.activePath)
    ? stored.activePath
    : openPaths.includes(project.rootDocument) ? project.rootDocument : openPaths[0];
  return { project, openPaths, activePath };
}
