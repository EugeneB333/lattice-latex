import type { BuildResult, ProjectSnapshot, SyncTexPdfPosition } from "../types";

export interface ProjectSession {
  project: ProjectSnapshot;
  openPaths: string[];
  activePath: string;
  buildResult?: BuildResult;
  syncTarget?: SyncTexPdfPosition;
}

export function createProjectSession(
  project: ProjectSnapshot,
  activePath = project.rootDocument,
): ProjectSession {
  return {
    project,
    openPaths: [activePath],
    activePath,
  };
}

export function upsertProjectSession(
  sessions: ProjectSession[],
  project: ProjectSnapshot,
  activePath = project.rootDocument,
): ProjectSession[] {
  const existing = sessions.find((session) => session.project.root === project.root);
  if (!existing) return [...sessions, createProjectSession(project, activePath)];
  return sessions.map((session) => session.project.root === project.root
    ? {
      ...session,
      project,
      activePath,
      openPaths: session.openPaths.includes(activePath)
        ? session.openPaths
        : [...session.openPaths, activePath],
    }
    : session);
}

export function openSessionFile(
  sessions: ProjectSession[],
  root: string,
  path: string,
): ProjectSession[] {
  return sessions.map((session) => session.project.root === root
    ? {
      ...session,
      activePath: path,
      openPaths: session.openPaths.includes(path)
        ? session.openPaths
        : [...session.openPaths, path],
    }
    : session);
}

export function closeSessionFile(
  sessions: ProjectSession[],
  root: string,
  path: string,
): { sessions: ProjectSession[]; nextPath?: string } {
  const target = sessions.find((session) => session.project.root === root);
  if (!target || target.openPaths.length <= 1 || !target.openPaths.includes(path)) {
    return { sessions, nextPath: target?.activePath };
  }
  const closingIndex = target.openPaths.indexOf(path);
  const openPaths = target.openPaths.filter((candidate) => candidate !== path);
  const nextPath = target.activePath === path
    ? openPaths[Math.min(closingIndex, openPaths.length - 1)]
    : target.activePath;
  return {
    sessions: sessions.map((session) => session.project.root === root
      ? { ...session, openPaths, activePath: nextPath }
      : session),
    nextPath,
  };
}

export function closeProjectSession(
  sessions: ProjectSession[],
  root: string,
): { sessions: ProjectSession[]; nextRoot?: string } {
  const closingIndex = sessions.findIndex((session) => session.project.root === root);
  if (closingIndex < 0 || sessions.length <= 1) {
    return { sessions, nextRoot: sessions[closingIndex]?.project.root };
  }
  const remaining = sessions.filter((session) => session.project.root !== root);
  return {
    sessions: remaining,
    nextRoot: remaining[Math.min(closingIndex, remaining.length - 1)].project.root,
  };
}
