import { describe, expect, it } from "vitest";
import { ActionRegistry, FlowEngine, MemoryStateStore, createActionRun } from "../src/index.js";
import type { ActionContext, ActionDefinition, ActionResult, FlowDefinition } from "../src/index.js";

function createContext(): ActionContext {
  const deadline = performance.now() + 1000;

  return {
    now: () => performance.now(),
    deadline: () => deadline,
    remainingMs: () => Math.max(0, deadline - performance.now()),
    shouldYield: () => false,
    log: () => undefined
  };
}

describe("runtime skeleton", () => {
  it("registers actions", () => {
    const registry = new ActionRegistry();
    const action: ActionDefinition<string, string, never> = {
      id: "echo",
      version: "1.0.0",
      mode: "instant",
      inputSchema: undefined,
      outputSchema: undefined,
      stateSchema: undefined,
      sideEffects: ["none"],
      run(input) {
        return { type: "done", output: input };
      }
    };

    registry.register(action);

    expect(registry.get("echo")).toBe(action);
  });

  it("exports action result variants", () => {
    const result: ActionResult<string, { cursor: number }> = {
      type: "waiting",
      state: { cursor: 1 },
      reason: "external-event"
    };

    expect(result.type).toBe("waiting");
  });

  it("creates and stores run records", () => {
    const store = new MemoryStateStore();
    const actionRun = createActionRun({ id: "action-run-1", actionId: "echo" });
    const flow: FlowDefinition = {
      id: "flow-1",
      version: "1.0.0",
      root: { type: "action", id: "node-1", action: "echo" }
    };
    const flowRun = new FlowEngine().createRun("flow-run-1", flow);

    store.saveActionRun(actionRun);
    store.saveFlowRun(flowRun);

    expect(store.getActionRun("action-run-1")).toEqual(actionRun);
    expect(store.getFlowRun("flow-run-1")).toEqual(flowRun);
    expect(createContext().shouldYield()).toBe(false);
  });
});
