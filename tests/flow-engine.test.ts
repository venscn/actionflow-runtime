import { describe, expect, it, vi } from "vitest";
import { ActionRegistry, FlowEngine } from "../src/index.js";
import type { ActionDefinition, FlowDefinition } from "../src/index.js";

describe("FlowEngine", () => {
  it("runs two instant actions in sequence", async () => {
    const registry = new ActionRegistry();
    registry.register(createInstantAction("first", "one"));
    registry.register(createInstantAction("second", "two"));
    const flow = createSequenceFlow([
      { type: "action", id: "node-1", action: "first", input: "a" },
      { type: "action", id: "node-2", action: "second", input: "b" }
    ]);
    const engine = new FlowEngine(registry);

    const run = await engine.tick(engine.createRun("flow-run-1", flow), flow);

    expect(run.status).toBe("done");
    expect(run.nodeRuns["node-1"]).toMatchObject({ status: "done", output: "one" });
    expect(run.nodeRuns["node-2"]).toMatchObject({ status: "done", output: "two" });
  });

  it("fails the flow when the first instant action fails and skips later actions", async () => {
    const registry = new ActionRegistry();
    const secondRun = vi.fn(() => ({ type: "done" as const, output: "two" }));
    registry.register(createFailedInstantAction("first"));
    registry.register(createInstantAction("second", "two", secondRun));
    const flow = createSequenceFlow([
      { type: "action", id: "node-1", action: "first" },
      { type: "action", id: "node-2", action: "second" }
    ]);
    const engine = new FlowEngine(registry);

    const run = await engine.tick(engine.createRun("flow-run-1", flow), flow);

    expect(run.status).toBe("failed");
    expect(run.nodeRuns["node-1"]?.status).toBe("failed");
    expect(run.nodeRuns["node-2"]).toBeUndefined();
    expect(secondRun).not.toHaveBeenCalled();
  });

  it("continues a yielded sliceable action before moving to the next action", async () => {
    const registry = new ActionRegistry();
    registry.register(createCounterAction(2));
    registry.register(createInstantAction("after", "after-done"));
    const flow = createSequenceFlow([
      { type: "action", id: "counter-node", action: "counter", input: 0 },
      { type: "action", id: "after-node", action: "after" }
    ]);
    const engine = new FlowEngine(registry);
    const initialRun = engine.createRun("flow-run-1", flow);

    const yieldedRun = await engine.tick(initialRun, flow);
    const doneRun = await engine.tick(yieldedRun, flow);

    expect(yieldedRun.status).toBe("running");
    expect(yieldedRun.nodeRuns["counter-node"]).toMatchObject({
      status: "running",
      actionRunId: "flow-run-1:counter-node"
    });
    expect(yieldedRun.actionRuns["counter-node"]?.state).toEqual({ count: 1 });
    expect(doneRun.status).toBe("done");
    expect(doneRun.nodeRuns["counter-node"]).toMatchObject({ status: "done", output: 2 });
    expect(doneRun.nodeRuns["after-node"]).toMatchObject({ status: "done", output: "after-done" });
  });

  it("marks a sequence done when all steps complete", async () => {
    const registry = new ActionRegistry();
    registry.register(createInstantAction("only", "done"));
    const flow = createSequenceFlow([{ type: "action", id: "node-1", action: "only" }]);
    const engine = new FlowEngine(registry);

    const run = await engine.tick(engine.createRun("flow-run-1", flow), flow);

    expect(run.status).toBe("done");
    expect(run.nodeRuns["root"]).toMatchObject({ status: "done" });
  });

  it("runs a single action root", async () => {
    const registry = new ActionRegistry();
    registry.register(createInstantAction("single", "single-done"));
    const flow: FlowDefinition = {
      id: "flow",
      version: "1.0.0",
      root: { type: "action", id: "single-node", action: "single", input: "x" }
    };
    const engine = new FlowEngine(registry);

    const run = await engine.tick(engine.createRun("flow-run-1", flow), flow);

    expect(run.status).toBe("done");
    expect(run.nodeRuns["single-node"]).toMatchObject({ status: "done", output: "single-done" });
  });
});

function createSequenceFlow(steps: FlowDefinition["root"][]): FlowDefinition {
  return {
    id: "flow",
    version: "1.0.0",
    root: {
      type: "sequence",
      id: "root",
      steps
    }
  };
}

function createInstantAction(
  id: string,
  output: string,
  run: ActionDefinition<unknown, string, never>["run"] = () => ({ type: "done", output })
): ActionDefinition<unknown, string, never> {
  return {
    id,
    version: "1.0.0",
    mode: "instant",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    run
  };
}

function createFailedInstantAction(id: string): ActionDefinition<unknown, string, never> {
  const error = new Error("failed");

  return createInstantAction(id, "unused", () => ({ type: "failed", error }));
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
