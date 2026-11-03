const STORAGE_KEY = "lattice-recent-projects";
const MAX_RECENT_PROJECTS = 10;

export interface RecentProject {
  root: string;
  name: string;
}

export function recentProjectsFromStorage(value: string | null): RecentProject[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed
      .filter((item): item is RecentProject => Boolean(
        item
        && typeof item === "object"
        && typeof (item as RecentProject).root === "string"
        && (item as RecentProject).root
        && typeof (item as RecentProject).name === "string",
      ))
      .filter((item) => {
        if (seen.has(item.root)) return false;
        seen.add(item.root);
        return true;
      })
      .slice(0, MAX_RECENT_PROJECTS);
  } catch {
    return [];
  }
}

export function rememberRecentProject(
  recent: RecentProject[],
  project: RecentProject,
): RecentProject[] {
  return [project, ...recent.filter((item) => item.root !== project.root)].slice(0, MAX_RECENT_PROJECTS);
}

export function loadRecentProjects(): RecentProject[] {
  if (typeof window === "undefined") return [];
  return recentProjectsFromStorage(window.localStorage.getItem(STORAGE_KEY));
}

export function storeRecentProjects(recent: RecentProject[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_PROJECTS)));
}
