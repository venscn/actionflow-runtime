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

  it("omits undefined optional fields from generated nodeRuns", async () => {
    const registry = new ActionRegistry();
    registry.register(createInstantAction("single", "ok"));
    const flow: FlowDefinition = {
      id: "flow",
      version: "1.0.0",
      root: { type: "action", id: "node-1", action: "single" }
    };
    const engine = new FlowEngine(registry);

    const run = await engine.tick(engine.createRun("flow-run-1", flow), flow);
    const nodeRun = run.nodeRuns["node-1"];

    expect(nodeRun).toMatchObject({
      status: "done",
      output: "ok"
    });
    expect(Object.prototype.hasOwnProperty.call(nodeRun, "error")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(nodeRun, "waitReason")).toBe(false);
  });

  it("advances three sliceable parallel branches in the same tick", async () => {
    const calls: string[] = [];
    const registry = new ActionRegistry();
    registry.register(createLoggedCounterAction("a", 2, calls));
    registry.register(createLoggedCounterAction("b", 2, calls));
    registry.register(createLoggedCounterAction("c", 2, calls));
    const flow = createParallelFlow([
      { type: "action", id: "branch-a", action: "a", input: 0 },
      { type: "action", id: "branch-b", action: "b", input: 0 },
      { type: "action", id: "branch-c", action: "c", input: 0 }
    ]);
    const engine = new FlowEngine(registry);

    const run = await engine.tick(engine.createRun("flow-run-1", flow), flow, { frameBudgetMs: 3, maxSliceMs: 1 });

    expect(run.status).toBe("running");
    expect(calls).toEqual(["a:0", "b:0", "c:0"]);
    expect(run.actionRuns["branch-a"]?.state).toEqual({ count: 1 });
    expect(run.actionRuns["branch-b"]?.state).toEqual({ count: 1 });
    expect(run.actionRuns["branch-c"]?.state).toEqual({ count: 1 });
  });

  it("finishes parallel branches across multiple small-budget ticks without completing one branch first", async () => {
    const calls: string[] = [];
    const registry = new ActionRegistry();
    registry.register(createLoggedCounterAction("a", 2, calls));
    registry.register(createLoggedCounterAction("b", 2, calls));
    registry.register(createLoggedCounterAction("c", 2, calls));
    const flow = createParallelFlow([
      { type: "action", id: "branch-a", action: "a", input: 0 },
      { type: "action", id: "branch-b", action: "b", input: 0 },
      { type: "action", id: "branch-c", action: "c", input: 0 }
    ]);
    const engine = new FlowEngine(registry);
    let run = engine.createRun("flow-run-1", flow);

    run = await engine.tick(run, flow, { frameBudgetMs: 1, maxSliceMs: 1 });
    run = await engine.tick(run, flow, { frameBudgetMs: 1, maxSliceMs: 1 });
    run = await engine.tick(run, flow, { frameBudgetMs: 1, maxSliceMs: 1 });

    expect(calls).toEqual(["a:0", "b:0", "c:0"]);
    expect(run.status).toBe("running");
    expect(run.nodeRuns["branch-a"]?.status).toBe("running");
    expect(run.nodeRuns["branch-b"]?.status).toBe("running");
    expect(run.nodeRuns["branch-c"]?.status).toBe("running");

    run = await engine.tick(run, flow, { frameBudgetMs: 3, maxSliceMs: 1 });

    expect(calls).toEqual(["a:0", "b:0", "c:0", "a:1", "b:1", "c:1"]);
    expect(run.status).toBe("done");
    expect(run.nodeRuns["parallel-root"]).toMatchObject({ status: "done" });
  });

  it("marks parallel failed when a branch fails", async () => {
    const registry = new ActionRegistry();
    registry.register(createCounterAction(1));
    registry.register(createFailedInstantAction("bad"));
    const flow = createParallelFlow([
      { type: "action", id: "branch-good", action: "counter", input: 0 },
      { type: "action", id: "branch-bad", action: "bad" }
    ]);
    const engine = new FlowEngine(registry);

    const run = await engine.tick(engine.createRun("flow-run-1", flow), flow, { frameBudgetMs: 2, maxSliceMs: 1 });

    expect(run.status).toBe("failed");
    expect(run.nodeRuns["branch-bad"]?.status).toBe("failed");
    expect(run.nodeRuns["parallel-root"]?.status).toBe("failed");
  });

  it("marks parallel waiting when only waiting branches remain", async () => {
    const registry = new ActionRegistry();
    registry.register(createWaitingAction());
    registry.register(createCounterAction(2));
    const flow = createParallelFlow([
      { type: "action", id: "waiting-branch", action: "waiting", input: 0 },
      { type: "action", id: "active-branch", action: "counter", input: 0 }
    ]);
    const engine = new FlowEngine(registry);
    const initialRun = engine.createRun("flow-run-1", flow);

    const firstRun = await engine.tick(initialRun, flow, { frameBudgetMs: 2, maxSliceMs: 1 });
    const secondRun = await engine.tick(firstRun, flow, { frameBudgetMs: 2, maxSliceMs: 1 });

    expect(firstRun.status).toBe("running");
    expect(firstRun.nodeRuns["waiting-branch"]?.status).toBe("waiting");
    expect(firstRun.nodeRuns["active-branch"]?.status).toBe("running");
    expect(secondRun.status).toBe("waiting");
    expect(secondRun.nodeRuns["waiting-branch"]?.status).toBe("waiting");
    expect(secondRun.nodeRuns["active-branch"]?.status).toBe("done");
  });

  it("runs a single async action root that returns done", async () => {
    const registry = new ActionRegistry();
    registry.register(createAsyncDoneAction("async-done", "async-output"));
    const flow: FlowDefinition = {
      id: "flow",
      version: "1.0.0",
      root: { type: "action", id: "async-node", action: "async-done", input: "x" }
    };
    const engine = new FlowEngine(registry);

    const run = await engine.tick(engine.createRun("flow-run-1", flow), flow);

    expect(run.status).toBe("done");
    expect(run.nodeRuns["async-node"]).toMatchObject({ status: "done", output: "async-output" });
  });

  it("continues sequence after an async action returns done", async () => {
    const registry = new ActionRegistry();
    registry.register(createAsyncDoneAction("async-done", "async-output"));
    registry.register(createInstantAction("after", "after-output"));
    const flow = createSequenceFlow([
      { type: "action", id: "async-node", action: "async-done" },
      { type: "action", id: "after-node", action: "after" }
    ]);
    const engine = new FlowEngine(registry);

    const run = await engine.tick(engine.createRun("flow-run-1", flow), flow);

    expect(run.status).toBe("done");
    expect(run.nodeRuns["async-node"]).toMatchObject({ status: "done", output: "async-output" });
    expect(run.nodeRuns["after-node"]).toMatchObject({ status: "done", output: "after-output" });
  });

  it("marks flow waiting when an async action returns waiting", async () => {
    const registry = new ActionRegistry();
    registry.register(createAsyncWaitingAction("async-waiting"));
    const flow: FlowDefinition = {
      id: "flow",
      version: "1.0.0",
      root: { type: "action", id: "async-node", action: "async-waiting" }
    };
    const engine = new FlowEngine(registry);

    const run = await engine.tick(engine.createRun("flow-run-1", flow), flow);

    expect(run.status).toBe("waiting");
    expect(run.nodeRuns["async-node"]).toMatchObject({
      status: "waiting",
      waitReason: "external-event"
    });
    expect(run.actionRuns["async-node"]?.state).toEqual({ cursor: 1 });
  });

  it("marks flow failed when an async action returns failed", async () => {
    const registry = new ActionRegistry();
    registry.register(createAsyncFailedAction("async-failed"));
    const flow: FlowDefinition = {
      id: "flow",
      version: "1.0.0",
      root: { type: "action", id: "async-node", action: "async-failed" }
    };
    const engine = new FlowEngine(registry);

    const run = await engine.tick(engine.createRun("flow-run-1", flow), flow);

    expect(run.status).toBe("failed");
    expect(run.nodeRuns["async-node"]?.status).toBe("failed");
  });

  it("marks parallel done with async done and sliceable done branches", async () => {
    const registry = new ActionRegistry();
    registry.register(createAsyncDoneAction("async-done", "async-output"));
    registry.register(createCounterAction(1));
    const flow = createParallelFlow([
      { type: "action", id: "async-branch", action: "async-done" },
      { type: "action", id: "slice-branch", action: "counter", input: 0 }
    ]);
    const engine = new FlowEngine(registry);

    const run = await engine.tick(engine.createRun("flow-run-1", flow), flow, { frameBudgetMs: 2, maxSliceMs: 1 });

    expect(run.status).toBe("done");
    expect(run.nodeRuns["async-branch"]).toMatchObject({ status: "done", output: "async-output" });
    expect(run.nodeRuns["slice-branch"]).toMatchObject({ status: "done", output: 1 });
  });

  it("keeps parallel running for async waiting while a sliceable branch is active, then waiting", async () => {
    const registry = new ActionRegistry();
    registry.register(createAsyncWaitingAction("async-waiting"));
    registry.register(createCounterAction(2));
    const flow = createParallelFlow([
      { type: "action", id: "async-branch", action: "async-waiting" },
      { type: "action", id: "slice-branch", action: "counter", input: 0 }
    ]);
    const engine = new FlowEngine(registry);
    const initialRun = engine.createRun("flow-run-1", flow);

    const firstRun = await engine.tick(initialRun, flow, { frameBudgetMs: 1, maxSliceMs: 1 });
    const secondRun = await engine.tick(firstRun, flow, { frameBudgetMs: 1, maxSliceMs: 1 });

    expect(firstRun.status).toBe("running");
    expect(firstRun.nodeRuns["async-branch"]).toMatchObject({
      status: "waiting",
      waitReason: "external-event"
    });
    expect(firstRun.nodeRuns["slice-branch"]?.status).toBe("running");
    expect(secondRun.status).toBe("waiting");
    expect(secondRun.nodeRuns["slice-branch"]?.status).toBe("done");
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

function createParallelFlow(branches: FlowDefinition["root"][]): FlowDefinition {
  return {
    id: "flow",
    version: "1.0.0",
    root: {
      type: "parallel",
      id: "parallel-root",
      branches
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

function createAsyncDoneAction(id: string, output: string): ActionDefinition<unknown, string, { cursor: number }> {
  return {
    id,
    version: "1.0.0",
    mode: "async",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    run: async () => ({ type: "done", output })
  };
}

function createAsyncWaitingAction(id: string): ActionDefinition<unknown, string, { cursor: number }> {
  return {
    id,
    version: "1.0.0",
    mode: "async",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    run: async () => ({ type: "waiting", state: { cursor: 1 }, reason: "external-event" })
  };
}

function createAsyncFailedAction(id: string): ActionDefinition<unknown, string, { cursor: number }> {
  const error = new Error("async failed");

  return {
    id,
    version: "1.0.0",
    mode: "async",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    run: async () => ({ type: "failed", error })
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

function createLoggedCounterAction(
  id: string,
  limit: number,
  calls: string[]
): ActionDefinition<number, number, { count: number }> {
  return {
    id,
    version: "1.0.0",
    mode: "sliceable",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    start: (input) => ({ count: input }),
    resume: (state) => {
      calls.push(`${id}:${state.count}`);
      const next = { count: state.count + 1 };

      if (next.count >= limit) {
        return { type: "done", output: next.count };
      }

      return { type: "yield", state: next };
    }
  };
}
