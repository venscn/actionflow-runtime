import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  ActionFlowRuntime,
  ActionRegistry,
  type BatchStateStore,
  EventTriggerRegistry,
  FileStateStore,
  FlowRegistry,
  MemoryStateStore
} from "../src/index.js";
import type {
  ActionDefinition,
  ActionRunRecord,
  FlowDefinition,
  FlowEngineRunRecord,
  ProcessedEventRecord,
  StateStoreRunBatch
} from "../src/index.js";

describe("ActionFlowRuntime", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("creates default registries, store, and engine", () => {
    const runtime = new ActionFlowRuntime();

    expect(runtime.actions).toBeInstanceOf(ActionRegistry);
    expect(runtime.flows).toBeInstanceOf(FlowRegistry);
    expect(runtime.triggers).toBeInstanceOf(EventTriggerRegistry);
    expect(runtime.store).toBeInstanceOf(MemoryStateStore);
    expect(runtime.engine).toBeDefined();
  });

  it("registers actions and flows", () => {
    const runtime = new ActionFlowRuntime();
    const action = createInstantAction("echo", "ok");
    const flow = createFlow("flow.basic", "echo");

    runtime.registerAction(action);
    runtime.registerFlow(flow);

    expect(runtime.actions.get("echo")).toBe(action);
    expect(runtime.flows.get("flow.basic")).toBe(flow);
  });

  it("creates a flow run from a registered flow and saves it", () => {
    const runtime = new ActionFlowRuntime();
    const flow = createFlow("flow.basic", "echo");

    runtime.registerFlow(flow);
    const run = runtime.createRun("flow.basic", "flow-run-1");

    expect(run).toMatchObject({
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "ready"
    });
    expect(runtime.store.getFlowRun("flow-run-1")).toBe(run);
  });

  it("throws when creating a run for a missing flow", () => {
    const runtime = new ActionFlowRuntime();

    expect(() => runtime.createRun("missing", "flow-run-1")).toThrow("Flow not found: missing");
  });

  it("ticks an instant action flow and saves FlowRun and ActionRun records", async () => {
    const runtime = new ActionFlowRuntime();

    runtime.registerAction(createInstantAction("echo", "ok"));
    runtime.registerFlow(createFlow("flow.basic", "echo"));

    const initialRun = runtime.createRun("flow.basic", "flow-run-1");
    const nextRun = await runtime.tick(initialRun, "flow.basic");

    expect(nextRun.status).toBe("done");
    expect(runtime.store.getFlowRun("flow-run-1")).toBe(nextRun);
    expect(runtime.store.getActionRun("flow-run-1:node-1")).toMatchObject({
      status: "done",
      output: "ok"
    });
  });

  it("throws when ticking a missing flow", async () => {
    const runtime = new ActionFlowRuntime();
    const flow = createFlow("flow.basic", "echo");

    runtime.registerFlow(flow);
    const run = runtime.createRun("flow.basic", "flow-run-1");

    await expect(runtime.tick(run, "missing")).rejects.toThrow("Flow not found: missing");
  });

  it("accepts injected registries and store", () => {
    const actions = new ActionRegistry();
    const flows = new FlowRegistry();
    const triggers = new EventTriggerRegistry();
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({
      actionRegistry: actions,
      flowRegistry: flows,
      eventTriggerRegistry: triggers,
      stateStore: store
    });

    expect(runtime.actions).toBe(actions);
    expect(runtime.flows).toBe(flows);
    expect(runtime.triggers).toBe(triggers);
    expect(runtime.store).toBe(store);
  });

  it("can persist runs through an injected FileStateStore", async () => {
    const rootDir = mkdtempSync(path.join(os.tmpdir(), "actionflow-runtime-file-store-"));
    tempDirs.push(rootDir);
    const fileStore = new FileStateStore({ rootDir });
    const runtime = new ActionFlowRuntime({ stateStore: fileStore });
    const flow: FlowDefinition = {
      id: "flow.basic",
      version: "1.0.0",
      root: {
        type: "action",
        id: "node-1",
        action: "echo",
        input: null
      }
    };

    runtime.registerAction(createInstantAction("echo", "ok"));
    runtime.registerFlow(flow);

    const initialRun = runtime.createRun("flow.basic", "flow-run-1");
    const nextRun = await runtime.tick(initialRun, "flow.basic");

    expect(runtime.store).toBe(fileStore);
    expect(fileStore.getFlowRun("flow-run-1")).toEqual(nextRun);
    expect(fileStore.getActionRun("flow-run-1:node-1")).toMatchObject({
      status: "done",
      output: "ok"
    });
  });

  it("uses saveRunBatch when ticking with FileStateStore", async () => {
    const rootDir = mkdtempSync(path.join(os.tmpdir(), "actionflow-runtime-file-store-batch-"));
    tempDirs.push(rootDir);
    const fileStore = new RecordingFileStateStore({ rootDir });
    const runtime = new ActionFlowRuntime({ stateStore: fileStore });
    const flow: FlowDefinition = {
      id: "flow.basic",
      version: "1.0.0",
      root: {
        type: "action",
        id: "node-1",
        action: "echo",
        input: null
      }
    };

    runtime.registerAction(createInstantAction("echo", "ok"));
    runtime.registerFlow(flow);

    const initialRun = runtime.createRun("flow.basic", "flow-run-1");
    const nextRun = await runtime.tick(initialRun, "flow.basic");

    expect(fileStore.batchCalls).toHaveLength(1);
    expect(fileStore.getFlowRun("flow-run-1")).toEqual(nextRun);
    expect(fileStore.getActionRun("flow-run-1:node-1")).toMatchObject({
      status: "done",
      output: "ok"
    });
  });

  it("uses saveRunBatch when the store supports it", async () => {
    const store = new RecordingBatchStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    runtime.registerAction(createInstantAction("echo", "ok"));
    runtime.registerFlow(createFlow("flow.basic", "echo"));

    const initialRun = runtime.createRun("flow.basic", "flow-run-1");
    const nextRun = await runtime.tick(initialRun, "flow.basic");

    expect(nextRun.status).toBe("done");
    expect(store.batchCalls).toHaveLength(1);
    expect(store.getFlowRun("flow-run-1")).toBe(nextRun);
    expect(store.getActionRun("flow-run-1:node-1")).toMatchObject({
      output: "ok"
    });
  });

  it("falls back when the store does not support saveRunBatch", async () => {
    const store = new RecordingFallbackStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    runtime.registerAction(createInstantAction("echo", "ok"));
    runtime.registerFlow(createFlow("flow.basic", "echo"));

    const initialRun = runtime.createRun("flow.basic", "flow-run-1");
    await runtime.tick(initialRun, "flow.basic");

    expect(store.saveFlowRunCalls).toBe(2);
    expect(store.saveActionRunCalls).toBe(1);
    expect(store.getFlowRun("flow-run-1")).toMatchObject({ status: "done" });
    expect(store.getActionRun("flow-run-1:node-1")).toMatchObject({ output: "ok" });
  });

  it("propagates saveRunBatch errors", async () => {
    const error = new Error("batch failed");
    const store = new FailingBatchStateStore(error);
    const runtime = new ActionFlowRuntime({ stateStore: store });

    runtime.registerAction(createInstantAction("echo", "ok"));
    runtime.registerFlow(createFlow("flow.basic", "echo"));

    const initialRun = runtime.createRun("flow.basic", "flow-run-1");

    await expect(runtime.tick(initialRun, "flow.basic")).rejects.toBe(error);
  });

  it("indexes waiting ActionRuns when the store supports WaitingIndexStore", async () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    runtime.registerAction(createWaitingAsyncAction("wait.action", "external-event"));
    runtime.registerFlow(createFlow("flow.wait", "wait.action"));

    const initialRun = runtime.createRun("flow.wait", "flow-run-1");
    const nextRun = await runtime.tick(initialRun, "flow.wait");

    expect(nextRun.status).toBe("waiting");
    expect(store.listWaitingActionRuns()).toEqual([
      expect.objectContaining({
        runId: "flow-run-1:node-1",
        flowRunId: "flow-run-1",
        nodeId: "node-1",
        waitReason: "external-event",
        actionId: "wait.action",
        status: "waiting"
      })
    ]);
  });

  it("removes waiting index entry when the ActionRun is no longer waiting", async () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.indexWaitingActionRun(createWaitingStoredActionRun("flow-run-1:node-1", "external-event"));
    runtime.registerAction(createInstantAction("echo", "ok"));
    runtime.registerFlow(createFlow("flow.basic", "echo"));

    const initialRun = runtime.createRun("flow.basic", "flow-run-1");
    await runtime.tick(initialRun, "flow.basic");

    expect(store.listWaitingActionRuns()).toEqual([]);
  });

  it("does not require waiting index support", async () => {
    const store = new RecordingFallbackStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    runtime.registerAction(createWaitingAsyncAction("wait.action", "external-event"));
    runtime.registerFlow(createFlow("flow.wait", "wait.action"));

    const initialRun = runtime.createRun("flow.wait", "flow-run-1");
    const nextRun = await runtime.tick(initialRun, "flow.wait");

    expect(nextRun.status).toBe("waiting");
    expect(store.saveFlowRunCalls).toBe(2);
    expect(store.saveActionRunCalls).toBe(1);
    expect(store.getActionRun("flow-run-1:node-1")).toMatchObject({
      status: "waiting",
      waitReason: "external-event"
    });
  });

  it("propagates waiting index errors", async () => {
    const error = new Error("waiting index failed");
    const store = new FailingWaitingIndexStore(error);
    const runtime = new ActionFlowRuntime({ stateStore: store });

    runtime.registerAction(createWaitingAsyncAction("wait.action", "external-event"));
    runtime.registerFlow(createFlow("flow.wait", "wait.action"));

    const initialRun = runtime.createRun("flow.wait", "flow-run-1");

    await expect(runtime.tick(initialRun, "flow.wait")).rejects.toBe(error);
  });

  it("updates waiting index only after persistence succeeds", async () => {
    const error = new Error("batch failed");
    const store = new FailingBatchWaitingIndexStore(error);
    const runtime = new ActionFlowRuntime({ stateStore: store });

    runtime.registerAction(createWaitingAsyncAction("wait.action", "external-event"));
    runtime.registerFlow(createFlow("flow.wait", "wait.action"));

    const initialRun = runtime.createRun("flow.wait", "flow-run-1");

    await expect(runtime.tick(initialRun, "flow.wait")).rejects.toBe(error);
    expect(store.indexCalls).toBe(0);
  });

  it("matchWaitingRuns returns matching waiting entries by event name", () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.indexWaitingActionRun(createWaitingStoredActionRun("flow-run-1:node-1", "user.created"));
    store.indexWaitingActionRun(createWaitingStoredActionRun("flow-run-2:node-1", "order.created"));

    const result = runtime.matchWaitingRuns({ id: "event-1", name: "user.created" });

    expect(result.eventId).toBe("event-1");
    expect(result.matched).toEqual([
      expect.objectContaining({
        runId: "flow-run-1:node-1",
        waitReason: "user.created"
      })
    ]);
    expect(result.recovered).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("matchWaitingRuns returns empty matched for a nonmatching event", () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.indexWaitingActionRun(createWaitingStoredActionRun("flow-run-1:node-1", "user.created"));

    expect(runtime.matchWaitingRuns({ id: "event-1", name: "order.created" })).toEqual({
      eventId: "event-1",
      matched: [],
      recovered: [],
      skipped: []
    });
  });

  it("matchWaitingRuns returns empty matched when the store does not support waiting index", () => {
    const runtime = new ActionFlowRuntime({ stateStore: new RecordingFallbackStateStore() });

    expect(runtime.matchWaitingRuns({ id: "event-1", name: "user.created" })).toEqual({
      eventId: "event-1",
      matched: [],
      recovered: [],
      skipped: []
    });
  });

  it("matchWaitingRuns validates event id", () => {
    const runtime = new ActionFlowRuntime();

    expect(() => runtime.matchWaitingRuns({ id: "", name: "user.created" })).toThrow(
      "Runtime event id is required"
    );
    expect(() => runtime.matchWaitingRuns({ id: 1, name: "user.created" } as never)).toThrow(
      "Runtime event id is required"
    );
  });

  it("matchWaitingRuns validates event name", () => {
    const runtime = new ActionFlowRuntime();

    expect(() => runtime.matchWaitingRuns({ id: "event-1", name: "" })).toThrow(
      "Runtime event name is required"
    );
    expect(() => runtime.matchWaitingRuns({ id: "event-1", name: 1 } as never)).toThrow(
      "Runtime event name is required"
    );
  });

  it("matchWaitingRuns does not restore or tick", () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.indexWaitingActionRun(createWaitingStoredActionRun("missing-flow-run:node-1", "user.created"));

    const result = runtime.matchWaitingRuns({ id: "event-1", name: "user.created" });

    expect(result.matched).toHaveLength(1);
    expect(runtime.store.listFlowRuns()).toEqual([]);
    expect(runtime.store.listActionRuns()).toEqual([]);
  });

  it("matchWaitingRuns does not mutate waiting index", () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.indexWaitingActionRun(createWaitingStoredActionRun("flow-run-1:node-1", "user.created"));
    const before = store.listWaitingActionRuns();

    runtime.matchWaitingRuns({ id: "event-1", name: "user.created" });

    expect(store.listWaitingActionRuns()).toEqual(before);
  });

  it("matchWaitingRuns does not execute EventTriggerRegistry", () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.indexWaitingActionRun(createWaitingStoredActionRun("flow-run-1:node-1", "user.created"));
    runtime.registerTrigger({
      id: "trigger.user-created",
      event: "user.created",
      flow: "flow.user-created"
    });

    runtime.matchWaitingRuns({ id: "event-1", name: "user.created" });

    expect(runtime.triggers.has("trigger.user-created")).toBe(true);
    expect(store.listFlowRuns()).toEqual([]);
  });

  it("matchWaitingRuns propagates waiting index errors", () => {
    const error = new Error("waiting index list failed");
    const runtime = new ActionFlowRuntime({ stateStore: new FailingWaitingListStore(error) });

    expect(() => runtime.matchWaitingRuns({ id: "event-1", name: "user.created" })).toThrow(error);
  });

  it("previewEventRecovery restores matched FlowRun records by flowRunId", () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.saveFlowRun({
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "waiting"
    });
    store.indexWaitingActionRun(createWaitingStoredActionRun("flow-run-1:node-1", "user.created"));

    const result = runtime.previewEventRecovery({ id: "event-1", name: "user.created" });

    expect(result.matched).toHaveLength(1);
    expect(result.recovered).toEqual([
      expect.objectContaining({
        id: "flow-run-1",
        flowId: "flow.basic",
        status: "waiting"
      })
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("previewEventRecovery returns matched but skipped when flowRunId is missing", () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.indexWaitingActionRun(createWaitingStoredActionRun("standalone-run", "user.created"));

    const result = runtime.previewEventRecovery({ id: "event-1", name: "user.created" });

    expect(result.matched).toHaveLength(1);
    expect(result.recovered).toEqual([]);
    expect(result.skipped).toEqual([
      {
        runId: "standalone-run",
        reason: "Missing flowRunId"
      }
    ]);
  });

  it("previewEventRecovery skips missing FlowRun", () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.indexWaitingActionRun(createWaitingStoredActionRun("missing-flow-run:node-1", "user.created"));

    const result = runtime.previewEventRecovery({ id: "event-1", name: "user.created" });

    expect(result.matched).toHaveLength(1);
    expect(result.recovered).toEqual([]);
    expect(result.skipped).toEqual([
      {
        runId: "missing-flow-run:node-1",
        reason: "FlowRun not found: missing-flow-run"
      }
    ]);
  });

  it("previewEventRecovery deduplicates recovered FlowRuns", () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.saveFlowRun({
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "waiting"
    });
    store.indexWaitingActionRun(createWaitingStoredActionRun("flow-run-1:node-1", "user.created"));
    store.indexWaitingActionRun(createWaitingStoredActionRun("flow-run-1:node-2", "user.created"));

    const result = runtime.previewEventRecovery({ id: "event-1", name: "user.created" });

    expect(result.matched).toHaveLength(2);
    expect(result.recovered).toHaveLength(1);
    expect(result.recovered[0]?.id).toBe("flow-run-1");
  });

  it("previewEventRecovery does not tick", () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.saveFlowRun({
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "waiting"
    });
    store.indexWaitingActionRun(createWaitingStoredActionRun("flow-run-1:node-1", "user.created"));
    const flowRunCount = store.listFlowRuns().length;
    const actionRunCount = store.listActionRuns().length;

    const result = runtime.previewEventRecovery({ id: "event-1", name: "user.created" });

    expect(result.recovered).toHaveLength(1);
    expect(store.listFlowRuns()).toHaveLength(flowRunCount);
    expect(store.listActionRuns()).toHaveLength(actionRunCount);
  });

  it("previewEventRecovery does not mutate waiting index", () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.saveFlowRun({
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "waiting"
    });
    store.indexWaitingActionRun(createWaitingStoredActionRun("flow-run-1:node-1", "user.created"));
    const before = store.listWaitingActionRuns();

    runtime.previewEventRecovery({ id: "event-1", name: "user.created" });

    expect(store.listWaitingActionRuns()).toEqual(before);
  });

  it("previewEventRecovery does not execute EventTriggerRegistry", () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.saveFlowRun({
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "waiting"
    });
    store.indexWaitingActionRun(createWaitingStoredActionRun("flow-run-1:node-1", "user.created"));
    runtime.registerTrigger({
      id: "trigger.user-created",
      event: "user.created",
      flow: "flow.user-created"
    });
    const flowRunCount = store.listFlowRuns().length;

    runtime.previewEventRecovery({ id: "event-1", name: "user.created" });

    expect(runtime.triggers.has("trigger.user-created")).toBe(true);
    expect(store.listFlowRuns()).toHaveLength(flowRunCount);
  });

  it("previewEventRecovery returns empty when store lacks WaitingIndexStore", () => {
    const runtime = new ActionFlowRuntime({ stateStore: new RecordingFallbackStateStore() });

    expect(runtime.previewEventRecovery({ id: "event-1", name: "user.created" })).toEqual({
      eventId: "event-1",
      matched: [],
      recovered: [],
      skipped: []
    });
  });

  it("previewEventRecovery propagates waiting index list errors", () => {
    const error = new Error("waiting index list failed");
    const runtime = new ActionFlowRuntime({ stateStore: new FailingWaitingListStore(error) });

    expect(() => runtime.previewEventRecovery({ id: "event-1", name: "user.created" })).toThrow(error);
  });

  it("previewEventRecovery validates event id and name", () => {
    const runtime = new ActionFlowRuntime();

    expect(() => runtime.previewEventRecovery({ id: "", name: "user.created" })).toThrow(
      "Runtime event id is required"
    );
    expect(() => runtime.previewEventRecovery({ id: "event-1", name: "" })).toThrow(
      "Runtime event name is required"
    );
  });

  it("saves and reads processed events through default MemoryStateStore", () => {
    const runtime = new ActionFlowRuntime();
    const record = createProcessedEventRecord("started", "event-1");

    runtime.saveProcessedEvent(record);

    expect(runtime.getProcessedEvent("event-1")).toEqual(record);
    expect(runtime.listProcessedEvents()).toEqual([record]);
  });

  it("deletes processed events through default MemoryStateStore", () => {
    const runtime = new ActionFlowRuntime();

    runtime.saveProcessedEvent(createProcessedEventRecord("started", "event-1"));

    expect(runtime.deleteProcessedEvent("event-1")).toBe(true);
    expect(runtime.deleteProcessedEvent("event-1")).toBe(false);
    expect(runtime.getProcessedEvent("event-1")).toBeUndefined();
  });

  it("uses FileStateStore processed events when injected", () => {
    const rootDir = mkdtempSync(path.join(os.tmpdir(), "actionflow-runtime-processed-events-"));
    tempDirs.push(rootDir);
    const firstRuntime = new ActionFlowRuntime({
      stateStore: new FileStateStore({ rootDir })
    });
    const record = createProcessedEventRecord("completed", "event-1");

    firstRuntime.saveProcessedEvent(record);
    expect(firstRuntime.getProcessedEvent("event-1")).toEqual(record);
    expect(firstRuntime.listProcessedEvents()).toEqual([record]);

    const secondRuntime = new ActionFlowRuntime({
      stateStore: new FileStateStore({ rootDir })
    });

    expect(secondRuntime.getProcessedEvent("event-1")).toEqual(record);
    expect(secondRuntime.deleteProcessedEvent("event-1")).toBe(true);
    expect(secondRuntime.getProcessedEvent("event-1")).toBeUndefined();
  });

  it("processed event get/list/delete are safe when store lacks ProcessedEventStore", () => {
    const runtime = new ActionFlowRuntime({ stateStore: new RecordingFallbackStateStore() });

    expect(runtime.getProcessedEvent("event-1")).toBeUndefined();
    expect(runtime.listProcessedEvents()).toEqual([]);
    expect(runtime.deleteProcessedEvent("event-1")).toBe(false);
  });

  it("saveProcessedEvent throws when store lacks ProcessedEventStore", () => {
    const runtime = new ActionFlowRuntime({ stateStore: new RecordingFallbackStateStore() });

    expect(() => runtime.saveProcessedEvent(createProcessedEventRecord("started", "event-1"))).toThrow(
      "ProcessedEventStore is not supported"
    );
  });

  it("propagates processed event validation errors", () => {
    const runtime = new ActionFlowRuntime();

    expect(() => runtime.saveProcessedEvent({ ...createProcessedEventRecord("started"), eventId: "" })).toThrow(
      "eventId is required"
    );
    expect(() =>
      runtime.saveProcessedEvent({ ...createProcessedEventRecord("started"), status: "invalid" as never })
    ).toThrow("Invalid processed event status");
  });

  it("matchWaitingRuns does not write processed event records", () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.indexWaitingActionRun(createWaitingStoredActionRun("flow-run-1:node-1", "user.created"));

    runtime.matchWaitingRuns({ id: "event-1", name: "user.created" });

    expect(runtime.listProcessedEvents()).toEqual([]);
  });

  it("previewEventRecovery does not write processed event records", () => {
    const store = new MemoryStateStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.saveFlowRun({
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "waiting"
    });
    store.indexWaitingActionRun(createWaitingStoredActionRun("flow-run-1:node-1", "user.created"));

    runtime.previewEventRecovery({ id: "event-1", name: "user.created" });

    expect(runtime.listProcessedEvents()).toEqual([]);
  });

  it("processed event APIs do not execute EventTriggerRegistry", () => {
    const runtime = new ActionFlowRuntime();

    runtime.registerTrigger({
      id: "trigger.user-created",
      event: "user.created",
      flow: "flow.user-created"
    });
    runtime.saveProcessedEvent(createProcessedEventRecord("started", "event-1"));
    runtime.getProcessedEvent("event-1");
    runtime.listProcessedEvents();
    runtime.deleteProcessedEvent("event-1");

    expect(runtime.triggers.has("trigger.user-created")).toBe(true);
    expect(runtime.store.listFlowRuns()).toEqual([]);
  });

  it("throws when restoring a missing FlowRun", () => {
    const runtime = new ActionFlowRuntime();

    expect(() => runtime.restoreRun("missing-flow-run")).toThrow("FlowRun not found: missing-flow-run");
  });

  it("restores a saved base FlowRun and fills FlowEngine fields", () => {
    const runtime = new ActionFlowRuntime();

    runtime.store.saveFlowRun({
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "ready"
    });

    const restored = runtime.restoreRun("flow-run-1");

    expect(restored).toMatchObject({
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "ready"
    });
    expect(restored.nodeRuns).toEqual({});
    expect(restored.actionRuns).toEqual({});
    expect(restored.sequenceCursors).toEqual({});
    expect(restored.parallelCursors).toEqual({});
  });

  it("restores a saved done FlowRun and merges saved ActionRuns", async () => {
    const runtime = new ActionFlowRuntime();

    runtime.registerAction(createInstantAction("echo", "ok"));
    runtime.registerFlow(createFlow("flow.basic", "echo"));

    const initialRun = runtime.createRun("flow.basic", "flow-run-1");
    await runtime.tick(initialRun, "flow.basic");

    const restored = runtime.restoreRun("flow-run-1");

    expect(restored.status).toBe("done");
    expect(restored.nodeRuns["node-1"]).toMatchObject({ status: "done", output: "ok" });
    expect(restored.actionRuns["node-1"]).toMatchObject({
      runId: "flow-run-1:node-1",
      output: "ok"
    });
  });

  it("restoreRun merges only ActionRuns matching the flowRunId prefix", () => {
    const runtime = new ActionFlowRuntime();

    runtime.store.saveFlowRun({
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "running"
    });
    runtime.store.saveActionRun(createStoredActionRun("flow-run-1:node-1", "matching"));
    runtime.store.saveActionRun(createStoredActionRun("other-flow-run:node-1", "other"));

    const restored = runtime.restoreRun("flow-run-1");

    expect(Object.keys(restored.actionRuns)).toEqual(["node-1"]);
    expect(restored.actionRuns["node-1"]?.output).toBe("matching");
  });

  it("restoreRun uses the node id suffix after the prefix as the actionRuns key", () => {
    const runtime = new ActionFlowRuntime();

    runtime.store.saveFlowRun({
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "running"
    });
    runtime.store.saveActionRun(createStoredActionRun("flow-run-1:branch-a", "ok"));

    const restored = runtime.restoreRun("flow-run-1");

    expect(restored.actionRuns["branch-a"]).toMatchObject({
      runId: "flow-run-1:branch-a",
      output: "ok"
    });
  });

  it("restoreRun preserves nested-looking suffixes as complete actionRuns keys", () => {
    const runtime = new ActionFlowRuntime();

    runtime.store.saveFlowRun({
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "running"
    });
    runtime.store.saveActionRun(createStoredActionRun("flow-run-1:parallel-root/branch-a", "slash"));
    runtime.store.saveActionRun(createStoredActionRun("flow-run-1:parallel-root:branch-b", "colon"));

    const restored = runtime.restoreRun("flow-run-1");

    expect(restored.actionRuns["parallel-root/branch-a"]?.output).toBe("slash");
    expect(restored.actionRuns["parallel-root:branch-b"]?.output).toBe("colon");
  });

  it("restoreRun lets standalone ActionRun records override embedded actionRuns with the same key", () => {
    const runtime = new ActionFlowRuntime();
    const flowRun: FlowEngineRunRecord = {
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "done",
      nodeRuns: {},
      actionRuns: {
        "node-1": createStoredActionRun("flow-run-1:node-1", "old")
      },
      sequenceCursors: {},
      parallelCursors: {}
    };

    runtime.store.saveFlowRun(flowRun);
    runtime.store.saveActionRun(createStoredActionRun("flow-run-1:node-1", "new"));

    const restored = runtime.restoreRun("flow-run-1");

    expect(restored.actionRuns["node-1"]?.output).toBe("new");
  });

  it("restoreRun preserves existing nodeRuns and cursors from the saved FlowRun", () => {
    const runtime = new ActionFlowRuntime();
    const flowRun: FlowEngineRunRecord = {
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "running",
      nodeRuns: {
        "node-1": {
          nodeId: "node-1",
          status: "done",
          output: "ok"
        }
      },
      actionRuns: {},
      sequenceCursors: {
        root: 1
      },
      parallelCursors: {
        "parallel-root": 2
      }
    };

    runtime.store.saveFlowRun(flowRun);

    const restored = runtime.restoreRun("flow-run-1");

    expect(restored.nodeRuns["node-1"]).toMatchObject({
      status: "done",
      output: "ok"
    });
    expect(restored.sequenceCursors).toEqual({ root: 1 });
    expect(restored.parallelCursors).toEqual({ "parallel-root": 2 });
  });

  it("restoreRun does not mutate or share nested saved FlowRun record objects", () => {
    const runtime = new ActionFlowRuntime();
    const flowRun: FlowEngineRunRecord = {
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "running",
      nodeRuns: {
        "node-1": {
          nodeId: "node-1",
          status: "running"
        }
      },
      actionRuns: {},
      sequenceCursors: {},
      parallelCursors: {}
    };

    runtime.store.saveFlowRun(flowRun);

    const restored = runtime.restoreRun("flow-run-1");
    restored.nodeRuns["node-1"] = {
      nodeId: "node-1",
      status: "failed"
    };
    restored.sequenceCursors.root = 99;

    const storedRun = runtime.store.getFlowRun("flow-run-1");

    expect(storedRun).toMatchObject({
      nodeRuns: {
        "node-1": {
          status: "running"
        }
      },
      sequenceCursors: {}
    });
  });

  it("restores a FileStateStore run from a new runtime instance", async () => {
    const rootDir = mkdtempSync(path.join(os.tmpdir(), "actionflow-runtime-restore-"));
    tempDirs.push(rootDir);
    const firstRuntime = new ActionFlowRuntime({
      stateStore: new FileStateStore({ rootDir })
    });

    firstRuntime.registerAction(createInstantAction("echo", "ok"));
    firstRuntime.registerFlow(createFlowWithInput("flow.basic", "echo", null));

    const initialRun = firstRuntime.createRun("flow.basic", "flow-run-1");
    await firstRuntime.tick(initialRun, "flow.basic");

    const secondRuntime = new ActionFlowRuntime({
      stateStore: new FileStateStore({ rootDir })
    });
    secondRuntime.registerAction(createInstantAction("echo", "ok"));
    secondRuntime.registerFlow(createFlowWithInput("flow.basic", "echo", null));

    const restored = secondRuntime.restoreRun("flow-run-1");

    expect(restored.status).toBe("done");
    expect(restored.actionRuns["node-1"]?.output).toBe("ok");
  });

  it("persists and resumes a yielded sliceable run through FileStateStore", async () => {
    const rootDir = mkdtempSync(path.join(os.tmpdir(), "actionflow-runtime-sliceable-"));
    tempDirs.push(rootDir);
    const firstRuntime = new ActionFlowRuntime({
      stateStore: new FileStateStore({ rootDir })
    });

    firstRuntime.registerAction(createCounterAction(2));
    firstRuntime.registerFlow(createFlowWithNumberInput("flow.count", "counter", 0));

    const initialRun = firstRuntime.createRun("flow.count", "flow-run-1");
    const yieldedRun = await firstRuntime.tick(initialRun, "flow.count");

    expect(yieldedRun.status).toBe("running");
    expect(firstRuntime.store.getActionRun("flow-run-1:node-1")).toMatchObject({
      status: "ready",
      state: { count: 1 }
    });

    const secondRuntime = new ActionFlowRuntime({
      stateStore: new FileStateStore({ rootDir })
    });
    secondRuntime.registerAction(createCounterAction(2));
    secondRuntime.registerFlow(createFlowWithNumberInput("flow.count", "counter", 0));

    const restoredRun = secondRuntime.restoreRun("flow-run-1");
    const doneRun = await secondRuntime.tick(restoredRun, "flow.count");

    expect(doneRun.status).toBe("done");
    expect(doneRun.actionRuns["node-1"]).toMatchObject({
      status: "done",
      output: 2
    });
  });

  it("restoreRun does not tick or duplicate saved action runs", async () => {
    const runtime = new ActionFlowRuntime();

    runtime.registerAction(createInstantAction("echo", "ok"));
    runtime.registerFlow(createFlow("flow.basic", "echo"));

    const initialRun = runtime.createRun("flow.basic", "flow-run-1");
    await runtime.tick(initialRun, "flow.basic");
    const flowRunCount = runtime.store.listFlowRuns().length;
    const actionRunCount = runtime.store.listActionRuns().length;

    runtime.restoreRun("flow-run-1");

    expect(runtime.store.listFlowRuns()).toHaveLength(flowRunCount);
    expect(runtime.store.listActionRuns()).toHaveLength(actionRunCount);
  });

  it("restoreRun does not require the flow to be registered", () => {
    const store = new MemoryStateStore();
    store.saveFlowRun({
      id: "flow-run-1",
      flowId: "flow.basic",
      status: "ready"
    });
    const runtime = new ActionFlowRuntime({ stateStore: store });

    const restored = runtime.restoreRun("flow-run-1");

    expect(restored.flowId).toBe("flow.basic");
    expect(restored.status).toBe("ready");
  });

  it("registers triggers without automatically running flows", () => {
    const runtime = new ActionFlowRuntime();

    runtime.registerTrigger({
      id: "trigger.created",
      event: "record.created",
      flow: "flow.basic"
    });

    expect(runtime.triggers.has("trigger.created")).toBe(true);
    expect(runtime.store.listFlowRuns()).toEqual([]);
  });

  it("checks package manifest structure before registry consistency", () => {
    const runtime = new ActionFlowRuntime();

    const result = runtime.checkPackageManifest({});

    expect(result.valid).toBe(false);
    expect(result).toMatchObject({
      errors: expect.arrayContaining([
        "id must be a non-empty string",
        "name must be a non-empty string",
        "version must be a non-empty string"
      ])
    });
  });

  it("reports missing manifest actions", () => {
    const runtime = new ActionFlowRuntime();

    expect(
      runtime.checkPackageManifest({
        id: "pkg",
        name: "Package",
        version: "1.0.0",
        actions: [{ id: "missing.action" }]
      })
    ).toEqual({
      valid: false,
      errors: ["Missing action: missing.action"]
    });
  });

  it("reports missing manifest flows", () => {
    const runtime = new ActionFlowRuntime();

    expect(
      runtime.checkPackageManifest({
        id: "pkg",
        name: "Package",
        version: "1.0.0",
        flows: [{ id: "missing.flow" }]
      })
    ).toEqual({
      valid: false,
      errors: ["Missing flow: missing.flow"]
    });
  });

  it("returns valid when manifest actions and flows exist", () => {
    const runtime = new ActionFlowRuntime();

    runtime.registerAction(createInstantAction("echo", "ok"));
    runtime.registerFlow(createFlow("flow.basic", "echo"));

    expect(
      runtime.checkPackageManifest({
        id: "pkg",
        name: "Package",
        version: "1.0.0",
        actions: [{ id: "echo", version: "1.0.0" }],
        flows: [{ id: "flow.basic", version: "1.0.0" }]
      })
    ).toEqual({ valid: true });
  });

  it("does not check rules.flow", () => {
    const runtime = new ActionFlowRuntime();

    expect(
      runtime.checkPackageManifest({
        id: "pkg",
        name: "Package",
        version: "1.0.0",
        rules: [{ id: "rule.start", event: "demo.started", flow: "missing.flow" }]
      })
    ).toEqual({ valid: true });
  });

  it("does not register actions or flows and does not execute flows during package checks", () => {
    const runtime = new ActionFlowRuntime();

    const result = runtime.checkPackageManifest({
      id: "pkg",
      name: "Package",
      version: "1.0.0"
    });

    expect(result).toEqual({ valid: true });
    expect(runtime.actions.list()).toEqual([]);
    expect(runtime.flows.list()).toEqual([]);
    expect(runtime.store.listFlowRuns()).toEqual([]);
    expect(runtime.store.listActionRuns()).toEqual([]);
  });
});

function createInstantAction(id: string, output: string): ActionDefinition<unknown, string, never> {
  return {
    id,
    version: "1.0.0",
    mode: "instant",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    run: () => ({ type: "done", output })
  };
}

function createWaitingAsyncAction(
  id: string,
  reason: string
): ActionDefinition<unknown, string, { cursor: number }> {
  return {
    id,
    version: "1.0.0",
    mode: "async",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    run: () => ({
      type: "waiting",
      state: { cursor: 1 },
      reason
    })
  };
}

function createStoredActionRun(runId: string, output: string) {
  return {
    id: runId,
    runId,
    actionId: "echo",
    actionVersion: "1.0.0",
    input: null,
    status: "done" as const,
    output
  };
}

function createWaitingStoredActionRun(runId: string, waitReason: string): ActionRunRecord {
  return {
    id: runId,
    runId,
    actionId: "wait.action",
    actionVersion: "1.0.0",
    input: null,
    status: "waiting",
    state: { cursor: 1 },
    waitReason
  };
}

function createFlow(id: string, action: string): FlowDefinition {
  return {
    id,
    version: "1.0.0",
    root: {
      type: "action",
      id: "node-1",
      action
    }
  };
}

function createFlowWithInput(id: string, action: string, input: null): FlowDefinition {
  return {
    id,
    version: "1.0.0",
    root: {
      type: "action",
      id: "node-1",
      action,
      input
    }
  };
}

function createFlowWithNumberInput(id: string, action: string, input: number): FlowDefinition {
  return {
    id,
    version: "1.0.0",
    root: {
      type: "action",
      id: "node-1",
      action,
      input
    }
  };
}

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

function createProcessedEventRecord(status: ProcessedEventRecord["status"], eventId = `event-${status}`): ProcessedEventRecord {
  const now = new Date().toISOString();

  return {
    eventId,
    eventName: "user.created",
    status,
    firstSeenAt: now,
    updatedAt: now,
    attemptCount: 1,
    matchedRunIds: ["flow-run-1:node-1"],
    recoveredFlowRunIds: ["flow-run-1"]
  };
}

class RecordingBatchStateStore extends MemoryStateStore {
  readonly batchCalls: StateStoreRunBatch[] = [];

  override saveRunBatch(batch: StateStoreRunBatch): void {
    this.batchCalls.push(batch);
    super.saveRunBatch(batch);
  }
}

class RecordingFileStateStore extends FileStateStore {
  readonly batchCalls: StateStoreRunBatch[] = [];

  override saveRunBatch(batch: StateStoreRunBatch): void {
    this.batchCalls.push(batch);
    super.saveRunBatch(batch);
  }
}

class FailingBatchStateStore extends MemoryStateStore {
  constructor(private readonly error: Error) {
    super();
  }

  override saveRunBatch(): void {
    throw this.error;
  }
}

class FailingWaitingIndexStore extends MemoryStateStore {
  constructor(private readonly error: Error) {
    super();
  }

  override indexWaitingActionRun(): void {
    throw this.error;
  }
}

class FailingBatchWaitingIndexStore extends MemoryStateStore {
  indexCalls = 0;

  constructor(private readonly error: Error) {
    super();
  }

  override saveRunBatch(): void {
    throw this.error;
  }

  override indexWaitingActionRun(run: ActionRunRecord): void {
    this.indexCalls += 1;
    super.indexWaitingActionRun(run);
  }
}

class FailingWaitingListStore extends MemoryStateStore {
  constructor(private readonly error: Error) {
    super();
  }

  override listWaitingActionRuns(): ReturnType<MemoryStateStore["listWaitingActionRuns"]> {
    throw this.error;
  }
}

class RecordingFallbackStateStore implements BatchlessStateStore {
  private readonly inner = new MemoryStateStore();
  saveFlowRunCalls = 0;
  saveActionRunCalls = 0;

  saveActionRun(run: ReturnType<typeof createStoredActionRun>): void {
    this.saveActionRunCalls += 1;
    this.inner.saveActionRun(run);
  }

  getActionRun(runId: string) {
    return this.inner.getActionRun(runId);
  }

  listActionRuns() {
    return this.inner.listActionRuns();
  }

  saveFlowRun(run: FlowEngineRunRecord): void {
    this.saveFlowRunCalls += 1;
    this.inner.saveFlowRun(run);
  }

  getFlowRun(flowRunId: string) {
    return this.inner.getFlowRun(flowRunId);
  }

  listFlowRuns() {
    return this.inner.listFlowRuns();
  }

  deleteActionRun(runId: string): boolean {
    return this.inner.deleteActionRun(runId);
  }

  deleteFlowRun(flowRunId: string): boolean {
    return this.inner.deleteFlowRun(flowRunId);
  }

  clear(): void {
    this.inner.clear();
  }
}

type BatchlessStateStore = Omit<BatchStateStore, "saveRunBatch">;
