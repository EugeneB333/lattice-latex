export type BuildRequestKind = "manual" | "live";

export interface BuildRequest {
  kind: BuildRequestKind;
  revision: number;
}

export interface BuildScheduler {
  currentRevision: () => number;
  dispose: () => void;
  invalidate: () => void;
  isCurrent: (revision: number) => boolean;
  noteEdit: () => void;
  requestManual: () => void;
  scheduleLive: () => void;
  setLiveEnabled: (enabled: boolean) => void;
}

export function createBuildScheduler(
  run: (request: BuildRequest) => Promise<void>,
  delayMs = 1600,
  onError: (error: unknown) => void = console.error,
): BuildScheduler {
  let disposed = false;
  let liveEnabled = false;
  let revision = 0;
  let running = false;
  let queued: BuildRequestKind | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const queueRequest = (kind: BuildRequestKind) => {
    if (kind === "manual" || !queued) queued = kind;
  };

  const execute = async (kind: BuildRequestKind) => {
    if (disposed || (kind === "live" && !liveEnabled)) return;
    if (running) {
      queueRequest(kind);
      return;
    }
    running = true;
    try {
      await run({ kind, revision });
    } catch (error) {
      onError(error);
    } finally {
      running = false;
      const next = queued;
      queued = undefined;
      if (next === "manual") {
        timer = setTimeout(() => { timer = undefined; void execute("manual"); }, 0);
      } else if (next === "live" && liveEnabled) {
        timer = setTimeout(() => { timer = undefined; void execute("live"); }, Math.min(250, delayMs));
      }
    }
  };

  const scheduleLive = () => {
    if (disposed || !liveEnabled) return;
    clearTimer();
    timer = setTimeout(() => {
      timer = undefined;
      void execute("live");
    }, delayMs);
  };

  return {
    currentRevision: () => revision,
    dispose: () => {
      disposed = true;
      clearTimer();
      queued = undefined;
    },
    invalidate: () => {
      revision += 1;
      clearTimer();
      if (queued === "live") queued = undefined;
    },
    isCurrent: (candidate) => candidate === revision,
    noteEdit: () => {
      revision += 1;
      scheduleLive();
    },
    requestManual: () => {
      clearTimer();
      void execute("manual");
    },
    scheduleLive,
    setLiveEnabled: (enabled) => {
      liveEnabled = enabled;
      if (!enabled) {
        clearTimer();
        if (queued === "live") queued = undefined;
      }
    },
  };
}
