import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  ActionFlowRuntime,
  ActionRegistry,
  EventTriggerRegistry,
  FileStateStore,
  FlowRegistry,
  MemoryStateStore
} from "../src/index.js";
import type { ActionDefinition, FlowDefinition } from "../src/index.js";

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
