import { afterEach, describe, expect, it, vi } from "vitest";
import { createBuildScheduler } from "./buildScheduler";

afterEach(() => vi.useRealTimers());

describe("build scheduler", () => {
  it("debounces edits and builds only the latest revision", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const scheduler = createBuildScheduler(run, 1600);
    scheduler.setLiveEnabled(true);

    scheduler.noteEdit();
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.noteEdit();
    await vi.advanceTimersByTimeAsync(1599);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith({ kind: "live", revision: 2 });
  });

  it("never overlaps builds and coalesces edits made during a build", async () => {
    vi.useFakeTimers();
    let finishFirst: (() => void) | undefined;
    const run = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
      .mockResolvedValue(undefined);
    const scheduler = createBuildScheduler(run, 1000);
    scheduler.setLiveEnabled(true);

    scheduler.noteEdit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);

    scheduler.noteEdit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);

    finishFirst?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(250);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith({ kind: "live", revision: 2 });
  });

  it("does no background work in on-demand mode but still accepts manual builds", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const scheduler = createBuildScheduler(run, 1000);

    scheduler.noteEdit();
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).not.toHaveBeenCalled();

    scheduler.requestManual();
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith({ kind: "manual", revision: 1 });
  });

  it("tracks revisions and invalidates pending live builds", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const scheduler = createBuildScheduler(run, 1000);
    expect(scheduler.currentRevision()).toBe(0);
    expect(scheduler.isCurrent(0)).toBe(true);
    scheduler.setLiveEnabled(true);
    scheduler.noteEdit();
    expect(scheduler.currentRevision()).toBe(1);
    expect(scheduler.isCurrent(0)).toBe(false);
    scheduler.invalidate();
    expect(scheduler.currentRevision()).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).not.toHaveBeenCalled();
  });

  it("manual work takes priority over queued live work", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const run = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    const scheduler = createBuildScheduler(run, 1000);
    scheduler.setLiveEnabled(true);
    scheduler.requestManual();
    await Promise.resolve();
    scheduler.scheduleLive();
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.requestManual();
    finish?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith({ kind: "manual", revision: 0 });
  });

  it("disabling live mode clears scheduled and queued live work", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const scheduler = createBuildScheduler(run, 1000);
    scheduler.setLiveEnabled(true);
    scheduler.scheduleLive();
    scheduler.setLiveEnabled(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).not.toHaveBeenCalled();
  });

  it("dispose cancels timers and ignores every later request", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);
    const scheduler = createBuildScheduler(run, 1000);
    scheduler.setLiveEnabled(true);
    scheduler.noteEdit();
    scheduler.dispose();
    scheduler.noteEdit();
    scheduler.requestManual();
    scheduler.scheduleLive();
    await vi.runAllTimersAsync();
    expect(run).not.toHaveBeenCalled();
  });

  it("reports run failures and remains usable", async () => {
    vi.useFakeTimers();
    const error = new Error("build failed");
    const run = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const onError = vi.fn();
    const scheduler = createBuildScheduler(run, 100, onError);
    scheduler.requestManual();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);
    scheduler.requestManual();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
