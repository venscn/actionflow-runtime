import { describe, expect, it } from "vitest";
import { MemoryStateStore, supportsRunBatch } from "../src/index.js";
import type { ActionRunRecord, FlowRunRecord, StateStore } from "../src/index.js";

describe("MemoryStateStore", () => {
  it("saves and reads an ActionRun", () => {
    const store = new MemoryStateStore();
    const run = createActionRun("action-run-1", "ready");

    store.saveActionRun(run);

    expect(store.getActionRun("action-run-1")).toEqual(run);
  });

  it("overwrites an ActionRun with the same runId", () => {
    const store = new MemoryStateStore();

    store.saveActionRun(createActionRun("action-run-1", "ready"));
    store.saveActionRun({ ...createActionRun("action-run-1", "done"), output: "ok" });

    expect(store.getActionRun("action-run-1")).toMatchObject({
      status: "done",
      output: "ok"
    });
    expect(store.listActionRuns()).toHaveLength(1);
  });

  it("lists multiple ActionRuns", () => {
    const store = new MemoryStateStore();
    const first = createActionRun("action-run-1", "ready");
    const second = createActionRun("action-run-2", "done");

    store.saveActionRun(first);
    store.saveActionRun(second);

    expect(store.listActionRuns()).toEqual(expect.arrayContaining([first, second]));
    expect(store.listActionRuns()).toHaveLength(2);
  });

  it("deletes an ActionRun", () => {
    const store = new MemoryStateStore();
    const run = createActionRun("action-run-1", "ready");

    store.saveActionRun(run);

    expect(store.deleteActionRun("action-run-1")).toBe(true);
    expect(store.deleteActionRun("action-run-1")).toBe(false);
    expect(store.getActionRun("action-run-1")).toBeUndefined();
  });

  it("saves and reads a FlowRun", () => {
    const store = new MemoryStateStore();
    const run = createFlowRun("flow-run-1", "ready");

    store.saveFlowRun(run);

    expect(store.getFlowRun("flow-run-1")).toEqual(run);
  });

  it("overwrites a FlowRun with the same id", () => {
    const store = new MemoryStateStore();

    store.saveFlowRun(createFlowRun("flow-run-1", "ready"));
    store.saveFlowRun(createFlowRun("flow-run-1", "done"));

    expect(store.getFlowRun("flow-run-1")).toMatchObject({ status: "done" });
    expect(store.listFlowRuns()).toHaveLength(1);
  });

  it("lists multiple FlowRuns", () => {
    const store = new MemoryStateStore();
    const first = createFlowRun("flow-run-1", "ready");
    const second = createFlowRun("flow-run-2", "done");

    store.saveFlowRun(first);
    store.saveFlowRun(second);

    expect(store.listFlowRuns()).toEqual(expect.arrayContaining([first, second]));
    expect(store.listFlowRuns()).toHaveLength(2);
  });

  it("deletes a FlowRun", () => {
    const store = new MemoryStateStore();
    const run = createFlowRun("flow-run-1", "ready");

    store.saveFlowRun(run);

    expect(store.deleteFlowRun("flow-run-1")).toBe(true);
    expect(store.deleteFlowRun("flow-run-1")).toBe(false);
    expect(store.getFlowRun("flow-run-1")).toBeUndefined();
  });

  it("clears ActionRuns and FlowRuns", () => {
    const store = new MemoryStateStore();

    store.saveActionRun(createActionRun("action-run-1", "ready"));
    store.saveFlowRun(createFlowRun("flow-run-1", "ready"));
    store.clear();

    expect(store.listActionRuns()).toEqual([]);
    expect(store.listFlowRuns()).toEqual([]);
  });

  it("saveRunBatch saves a FlowRun and ActionRuns", () => {
    const store = new MemoryStateStore();
    const flowRun = createFlowRun("flow-run-1", "running");
    const firstActionRun = createActionRun("flow-run-1:node-1", "done");
    const secondActionRun = createActionRun("flow-run-1:node-2", "ready");

    store.saveRunBatch({
      flowRun,
      actionRuns: [firstActionRun, secondActionRun]
    });

    expect(store.getFlowRun("flow-run-1")).toEqual(flowRun);
    expect(store.listActionRuns()).toEqual(expect.arrayContaining([firstActionRun, secondActionRun]));
  });

  it("saveRunBatch handles a missing FlowRun", () => {
    const store = new MemoryStateStore();
    const actionRun = createActionRun("flow-run-1:node-1", "done");

    store.saveRunBatch({
      actionRuns: [actionRun]
    });

    expect(store.listFlowRuns()).toEqual([]);
    expect(store.getActionRun("flow-run-1:node-1")).toEqual(actionRun);
  });

  it("saveRunBatch handles missing ActionRuns", () => {
    const store = new MemoryStateStore();
    const flowRun = createFlowRun("flow-run-1", "running");

    store.saveRunBatch({ flowRun });
    store.saveRunBatch({ actionRuns: [] });

    expect(store.getFlowRun("flow-run-1")).toEqual(flowRun);
    expect(store.listActionRuns()).toEqual([]);
  });

  it("supportsRunBatch returns true for MemoryStateStore", () => {
    expect(supportsRunBatch(new MemoryStateStore())).toBe(true);
  });

  it("supportsRunBatch returns false for a minimal StateStore", () => {
    expect(supportsRunBatch(new MinimalStateStore())).toBe(false);
  });
});

class MinimalStateStore implements StateStore {
  saveActionRun(): void {}

  getActionRun(): ActionRunRecord | undefined {
    return undefined;
  }

  listActionRuns(): readonly ActionRunRecord[] {
    return [];
  }

  saveFlowRun(): void {}

  getFlowRun(): FlowRunRecord | undefined {
    return undefined;
  }

  listFlowRuns(): readonly FlowRunRecord[] {
    return [];
  }

  deleteActionRun(): boolean {
    return false;
  }

  deleteFlowRun(): boolean {
    return false;
  }

  clear(): void {}
}

function createActionRun(runId: string, status: ActionRunRecord["status"]): ActionRunRecord {
  return {
    id: runId,
    runId,
    actionId: "echo",
    actionVersion: "1.0.0",
    status
  };
}

function createFlowRun(id: string, status: FlowRunRecord["status"]): FlowRunRecord {
  return {
    id,
    flowId: "flow",
    currentNodeId: "root",
    status
  };
}
