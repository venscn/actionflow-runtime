import { describe, expect, it } from "vitest";
import { ActionRegistry, FlowEngine, MemoryStateStore, createActionRun } from "../src/index.js";
import type { Action, Flow } from "../src/index.js";

describe("runtime skeleton", () => {
  it("registers actions", () => {
    const registry = new ActionRegistry();
    const action: Action = {
      metadata: {
        id: "echo",
        mode: "instant",
        sideEffects: ["none"]
      },
      run(input) {
        return { status: "completed", output: input };
      }
    };

    registry.register(action);

    expect(registry.get("echo")).toBe(action);
  });

  it("creates and stores run records", () => {
    const store = new MemoryStateStore();
    const actionRun = createActionRun({ id: "action-run-1", actionId: "echo" });
    const flow: Flow = {
      id: "flow-1",
      nodes: [{ id: "node-1", actionId: "echo" }]
    };
    const flowRun = new FlowEngine().createRun("flow-run-1", flow);

    store.saveActionRun(actionRun);
    store.saveFlowRun(flowRun);

    expect(store.getActionRun("action-run-1")).toEqual(actionRun);
    expect(store.getFlowRun("flow-run-1")).toEqual(flowRun);
  });
});
