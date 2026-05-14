import { describe, expect, it } from "vitest";
import { SliceScheduler, createActionRun } from "../src/index.js";
import type { ActionDefinition } from "../src/index.js";

describe("SliceScheduler", () => {
  it("advances multiple sliceable actions in turn", async () => {
    const scheduler = new SliceScheduler();
    const action = createCounterAction(2);

    scheduler.add(createActionRun({ id: "run-1", actionId: action.id, input: 0 }), action);
    scheduler.add(createActionRun({ id: "run-2", actionId: action.id, input: 0 }), action);

    const report = await scheduler.runFrame({ frameBudgetMs: 2, maxSliceMs: 1 });

    expect(report.slicesRun).toBe(2);
    expect(report.yieldedRuns).toEqual(["run-1", "run-2"]);
  });

  it("does not run every ready action when the frame budget is small", async () => {
    const scheduler = new SliceScheduler();
    const action = createCounterAction(2);

    scheduler.add(createActionRun({ id: "run-1", actionId: action.id, input: 0 }), action);
    scheduler.add(createActionRun({ id: "run-2", actionId: action.id, input: 0 }), action);
    scheduler.add(createActionRun({ id: "run-3", actionId: action.id, input: 0 }), action);

    const report = await scheduler.runFrame({ frameBudgetMs: 1, maxSliceMs: 1 });

    expect(report.slicesRun).toBe(1);
    expect(report.consumedMs).toBe(1);
  });

  it("does not continue scheduling a done action", async () => {
    const scheduler = new SliceScheduler();
    const action = createCounterAction(1);

    scheduler.add(createActionRun({ id: "run-1", actionId: action.id, input: 0 }), action);

    const firstReport = await scheduler.runFrame({ frameBudgetMs: 10, maxSliceMs: 1 });
    const secondReport = await scheduler.runFrame({ frameBudgetMs: 10, maxSliceMs: 1 });

    expect(firstReport.completedRuns).toEqual(["run-1"]);
    expect(secondReport.slicesRun).toBe(0);
  });

  it("does not continue scheduling a waiting action", async () => {
    const scheduler = new SliceScheduler();
    const action = createWaitingAction();

    scheduler.add(createActionRun({ id: "run-1", actionId: action.id, input: 0 }), action);

    const firstReport = await scheduler.runFrame({ frameBudgetMs: 10, maxSliceMs: 1 });
    const secondReport = await scheduler.runFrame({ frameBudgetMs: 10, maxSliceMs: 1 });

    expect(firstReport.waitingRuns).toEqual(["run-1"]);
    expect(secondReport.slicesRun).toBe(0);
  });

  it("does not continue scheduling a failed action", async () => {
    const scheduler = new SliceScheduler();
    const action = createFailedAction();

    scheduler.add(createActionRun({ id: "run-1", actionId: action.id, input: 0 }), action);

    const firstReport = await scheduler.runFrame({ frameBudgetMs: 10, maxSliceMs: 1 });
    const secondReport = await scheduler.runFrame({ frameBudgetMs: 10, maxSliceMs: 1 });

    expect(firstReport.failedRuns).toEqual(["run-1"]);
    expect(secondReport.slicesRun).toBe(0);
  });

  it("can read the updated run after a frame", async () => {
    const scheduler = new SliceScheduler();
    const action = createCounterAction(1);

    scheduler.add(createActionRun({ id: "run-1", actionId: action.id, input: 0 }), action);

    await scheduler.runFrame({ frameBudgetMs: 10, maxSliceMs: 1 });

    expect(scheduler.getRun("run-1")).toMatchObject({
      runId: "run-1",
      status: "done",
      output: 1
    });
  });

  it("lists managed runs", () => {
    const scheduler = new SliceScheduler();
    const action = createCounterAction(1);
    const firstRun = createActionRun({ id: "run-1", actionId: action.id, input: 0 });
    const secondRun = createActionRun({ id: "run-2", actionId: action.id, input: 0 });

    scheduler.add(firstRun, action);
    scheduler.add(secondRun, action);

    expect(scheduler.listRuns()).toEqual([firstRun, secondRun]);
  });
});

function createCounterAction(limit: number): ActionDefinition<number, number, { count: number }> {
  return {
    id: "counter",
    version: "1.0.0",
    mode: "sliceable",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    start: (input) => ({ count: input }),
    resume: (state) => {
      const next = { count: state.count + 1 };

      if (next.count >= limit) {
        return { type: "done", output: next.count };
      }

      return { type: "yield", state: next };
    }
  };
}

function createWaitingAction(): ActionDefinition<number, number, { count: number }> {
  return {
    id: "waiting",
    version: "1.0.0",
    mode: "sliceable",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    start: (input) => ({ count: input }),
    resume: (state) => ({ type: "waiting", state, reason: "external-event" })
  };
}

function createFailedAction(): ActionDefinition<number, number, { count: number }> {
  return {
    id: "failed",
    version: "1.0.0",
    mode: "sliceable",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    start: (input) => ({ count: input }),
    resume: () => ({ type: "failed", error: new Error("failed") })
  };
}
