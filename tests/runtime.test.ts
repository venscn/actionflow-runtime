import { describe, expect, it } from "vitest";
import {
  ActionFlowRuntime,
  ActionRegistry,
  EventTriggerRegistry,
  FlowRegistry,
  MemoryStateStore
} from "../src/index.js";
import type { ActionDefinition, FlowDefinition } from "../src/index.js";

describe("ActionFlowRuntime", () => {
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
