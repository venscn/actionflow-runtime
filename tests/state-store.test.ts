import { describe, expect, it } from "vitest";
import { MemoryStateStore, supportsProcessedEvents, supportsRunBatch, supportsWaitingIndex } from "../src/index.js";
import type { ActionRunRecord, FlowRunRecord, ProcessedEventRecord, StateStore } from "../src/index.js";

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

  it("supportsWaitingIndex returns true for MemoryStateStore", () => {
    expect(supportsWaitingIndex(new MemoryStateStore())).toBe(true);
  });

  it("supportsWaitingIndex returns false for a minimal StateStore", () => {
    expect(supportsWaitingIndex(new MinimalStateStore())).toBe(false);
  });

  it("supportsProcessedEvents returns false for MemoryStateStore", () => {
    expect(supportsProcessedEvents(new MemoryStateStore())).toBe(false);
  });

  it("supportsProcessedEvents returns false for a minimal StateStore", () => {
    expect(supportsProcessedEvents(new MinimalStateStore())).toBe(false);
  });

  it("supportsProcessedEvents returns true for a store with all processed event methods", () => {
    expect(supportsProcessedEvents(new ProcessedEventCapableStateStore())).toBe(true);
  });

  it("supportsProcessedEvents returns false when one method is missing", () => {
    expect(supportsProcessedEvents(new MissingDeleteProcessedEventStore())).toBe(false);
  });

  it("ProcessedEventRecord type accepts started, completed, and failed statuses", () => {
    const started: ProcessedEventRecord = createProcessedEventRecord("started");
    const completed: ProcessedEventRecord = createProcessedEventRecord("completed");
    const failed: ProcessedEventRecord = createProcessedEventRecord("failed");

    expect([started.status, completed.status, failed.status]).toEqual(["started", "completed", "failed"]);
  });

  it("ProcessedEventRecord supports optional error", () => {
    const record: ProcessedEventRecord = {
      ...createProcessedEventRecord("failed"),
      error: "recovery failed"
    };

    expect(record.error).toBe("recovery failed");
  });

  it("indexWaitingActionRun stores a waiting run", () => {
    const store = new MemoryStateStore();

    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-1", "external-event"));

    expect(store.listWaitingActionRuns()).toEqual([
      expect.objectContaining({
        runId: "flow-run-1:node-1",
        actionId: "wait.action",
        actionVersion: "1.0.0",
        waitReason: "external-event",
        status: "waiting"
      })
    ]);
  });

  it("indexWaitingActionRun requires waiting status", () => {
    const store = new MemoryStateStore();

    expect(() => store.indexWaitingActionRun(createActionRun("flow-run-1:node-1", "ready"))).toThrow(
      "ActionRun is not waiting"
    );
  });

  it("indexWaitingActionRun requires non-empty waitReason", () => {
    const store = new MemoryStateStore();

    expect(() => store.indexWaitingActionRun({ ...createWaitingActionRun("flow-run-1:node-1", ""), waitReason: "" })).toThrow(
      "waitReason is required"
    );
    expect(() =>
      store.indexWaitingActionRun({
        ...createWaitingActionRun("flow-run-1:node-1", "external-event"),
        waitReason: undefined
      })
    ).toThrow("waitReason is required");
  });

  it("indexWaitingActionRun derives flowRunId and nodeId from runId prefix", () => {
    const store = new MemoryStateStore();

    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-1", "external-event"));

    expect(store.listWaitingActionRuns()[0]).toMatchObject({
      flowRunId: "flow-run-1",
      nodeId: "node-1"
    });
  });

  it("indexWaitingActionRun preserves nested-ish node suffix", () => {
    const store = new MemoryStateStore();

    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:parallel-root:branch-a", "external-event"));

    expect(store.listWaitingActionRuns()[0]).toMatchObject({
      flowRunId: "flow-run-1",
      nodeId: "parallel-root:branch-a"
    });
  });

  it("indexWaitingActionRun overwrites the same runId", () => {
    const store = new MemoryStateStore();

    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-1", "first-event"));
    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-1", "second-event"));

    expect(store.listWaitingActionRuns()).toHaveLength(1);
    expect(store.listWaitingActionRuns()[0]).toMatchObject({
      waitReason: "second-event"
    });
  });

  it("removeWaitingActionRun removes an entry", () => {
    const store = new MemoryStateStore();

    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-1", "external-event"));
    store.removeWaitingActionRun("flow-run-1:node-1");

    expect(store.listWaitingActionRuns()).toEqual([]);
  });

  it("removeWaitingActionRun is safe for missing runId", () => {
    const store = new MemoryStateStore();

    expect(() => store.removeWaitingActionRun("missing-run")).not.toThrow();
  });

  it("listWaitingActionRuns filters by waitReason", () => {
    const store = new MemoryStateStore();

    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-1", "event-a"));
    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-2", "event-b"));

    expect(store.listWaitingActionRuns({ waitReason: "event-a" }).map((entry) => entry.runId)).toEqual([
      "flow-run-1:node-1"
    ]);
  });

  it("listWaitingActionRuns filters by flowRunId", () => {
    const store = new MemoryStateStore();

    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-1", "event"));
    store.indexWaitingActionRun(createWaitingActionRun("flow-run-2:node-1", "event"));

    expect(store.listWaitingActionRuns({ flowRunId: "flow-run-2" }).map((entry) => entry.runId)).toEqual([
      "flow-run-2:node-1"
    ]);
  });

  it("listWaitingActionRuns filters by actionId", () => {
    const store = new MemoryStateStore();

    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-1", "event", "wait.action"));
    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-2", "event", "other.action"));

    expect(store.listWaitingActionRuns({ actionId: "other.action" }).map((entry) => entry.runId)).toEqual([
      "flow-run-1:node-2"
    ]);
  });

  it("listWaitingActionRuns combines filters with AND semantics", () => {
    const store = new MemoryStateStore();

    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-1", "event-a", "wait.action"));
    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-2", "event-b", "wait.action"));
    store.indexWaitingActionRun(createWaitingActionRun("flow-run-2:node-1", "event-a", "wait.action"));

    expect(
      store
        .listWaitingActionRuns({
          waitReason: "event-a",
          flowRunId: "flow-run-1",
          actionId: "wait.action"
        })
        .map((entry) => entry.runId)
    ).toEqual(["flow-run-1:node-1"]);
  });

  it("listWaitingActionRuns returns deterministic runId-sorted results", () => {
    const store = new MemoryStateStore();

    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-c", "event"));
    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-a", "event"));
    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-b", "event"));

    expect(store.listWaitingActionRuns().map((entry) => entry.runId)).toEqual([
      "flow-run-1:node-a",
      "flow-run-1:node-b",
      "flow-run-1:node-c"
    ]);
  });

  it("clear removes waiting index entries and existing run records", () => {
    const store = new MemoryStateStore();

    store.saveActionRun(createActionRun("action-run-1", "ready"));
    store.saveFlowRun(createFlowRun("flow-run-1", "ready"));
    store.indexWaitingActionRun(createWaitingActionRun("flow-run-1:node-1", "external-event"));

    store.clear();

    expect(store.listActionRuns()).toEqual([]);
    expect(store.listFlowRuns()).toEqual([]);
    expect(store.listWaitingActionRuns()).toEqual([]);
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

class ProcessedEventCapableStateStore extends MinimalStateStore {
  getProcessedEvent(): ProcessedEventRecord | undefined {
    return undefined;
  }

  saveProcessedEvent(): void {}

  listProcessedEvents(): readonly ProcessedEventRecord[] {
    return [];
  }

  deleteProcessedEvent(): boolean {
    return false;
  }
}

class MissingDeleteProcessedEventStore extends MinimalStateStore {
  getProcessedEvent(): ProcessedEventRecord | undefined {
    return undefined;
  }

  saveProcessedEvent(): void {}

  listProcessedEvents(): readonly ProcessedEventRecord[] {
    return [];
  }
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

function createWaitingActionRun(runId: string, waitReason: string, actionId = "wait.action"): ActionRunRecord {
  return {
    id: runId,
    runId,
    actionId,
    actionVersion: "1.0.0",
    status: "waiting",
    state: { cursor: 1 },
    waitReason
  };
}

function createProcessedEventRecord(status: ProcessedEventRecord["status"]): ProcessedEventRecord {
  const now = new Date().toISOString();

  return {
    eventId: `event-${status}`,
    eventName: "user.created",
    status,
    firstSeenAt: now,
    updatedAt: now,
    attemptCount: 1,
    matchedRunIds: ["flow-run-1:node-1"],
    recoveredFlowRunIds: ["flow-run-1"]
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
