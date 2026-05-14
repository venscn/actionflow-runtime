import { describe, expect, it } from "vitest";
import { createActionRun, resumeActionRun, runActionOnce, runAsyncActionOnce } from "../src/index.js";
import type { ActionContext, ActionDefinition } from "../src/index.js";

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

function createInstantAction(
  run: ActionDefinition<string, string, never>["run"]
): ActionDefinition<string, string, never> {
  return {
    id: "echo",
    version: "1.0.0",
    mode: "instant",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    run
  };
}

describe("runActionOnce", () => {
  it("runs an instant action successfully", async () => {
    const action = createInstantAction((input) => ({ type: "done", output: input }));

    const run = await runActionOnce({
      runId: "run-1",
      action,
      input: "hello",
      context: createContext()
    });

    expect(run).toMatchObject({
      runId: "run-1",
      actionId: "echo",
      actionVersion: "1.0.0",
      input: "hello",
      status: "done",
      output: "hello"
    });
  });

  it("marks an instant action failed when it returns failed", async () => {
    const error = new Error("bad input");
    const action = createInstantAction(() => ({ type: "failed", error }));

    const run = await runActionOnce({
      runId: "run-1",
      action,
      input: "hello",
      context: createContext()
    });

    expect(run.status).toBe("failed");
    expect(run.error).toBe(error);
  });

  it("marks an instant action failed when it throws", async () => {
    const error = new Error("boom");
    const action = createInstantAction(() => {
      throw error;
    });

    const run = await runActionOnce({
      runId: "run-1",
      action,
      input: "hello",
      context: createContext()
    });

    expect(run.status).toBe("failed");
    expect(run.error).toBe(error);
  });

  it("fails explicitly for non-instant actions", async () => {
    const action: ActionDefinition<string, string, { cursor: number }> = {
      id: "wait",
      version: "1.0.0",
      mode: "async",
      inputSchema: undefined,
      outputSchema: undefined,
      stateSchema: undefined,
      sideEffects: [],
      run: () => ({ type: "waiting", state: { cursor: 0 }, reason: "external-event" })
    };

    const run = await runActionOnce({
      runId: "run-1",
      action,
      input: "hello",
      context: createContext()
    });

    expect(run.status).toBe("failed");
    expect(run.error).toBeInstanceOf(Error);
    expect(String(run.error)).toContain("Unsupported action mode");
  });
});

describe("runAsyncActionOnce", () => {
  it("marks async actions done when they resolve done", async () => {
    const action = createAsyncAction(async (input) => ({ type: "done", output: input }));

    const run = await runAsyncActionOnce({
      runId: "run-1",
      action,
      input: "hello",
      context: createContext()
    });

    expect(run).toMatchObject({
      status: "done",
      output: "hello"
    });
  });

  it("marks async actions waiting when they resolve waiting", async () => {
    const action = createAsyncAction(async () => ({
      type: "waiting",
      state: { cursor: 1 },
      reason: "external-event"
    }));

    const run = await runAsyncActionOnce({
      runId: "run-1",
      action,
      input: "hello",
      context: createContext()
    });

    expect(run.status).toBe("waiting");
    expect(run.state).toEqual({ cursor: 1 });
    expect(run.waitReason).toBe("external-event");
  });

  it("marks async actions failed when they resolve failed", async () => {
    const error = new Error("async failed");
    const action = createAsyncAction(async () => ({ type: "failed", error }));

    const run = await runAsyncActionOnce({
      runId: "run-1",
      action,
      input: "hello",
      context: createContext()
    });

    expect(run.status).toBe("failed");
    expect(run.error).toBe(error);
  });

  it("marks async actions failed when the promise rejects", async () => {
    const error = new Error("rejected");
    const action = createAsyncAction(async () => {
      throw error;
    });

    const run = await runAsyncActionOnce({
      runId: "run-1",
      action,
      input: "hello",
      context: createContext()
    });

    expect(run.status).toBe("failed");
    expect(run.error).toBe(error);
  });

  it("fails when an async action is missing run", async () => {
    const action: ActionDefinition<string, string, { cursor: number }> = {
      id: "missing-run",
      version: "1.0.0",
      mode: "async",
      inputSchema: undefined,
      outputSchema: undefined,
      stateSchema: undefined,
      sideEffects: []
    };

    const run = await runAsyncActionOnce({
      runId: "run-1",
      action,
      input: "hello",
      context: createContext()
    });

    expect(run.status).toBe("failed");
    expect(run.error).toBeInstanceOf(Error);
    expect(String(run.error)).toContain("missing run");
  });

  it("fails explicitly for non-async actions", async () => {
    const action = createInstantAction((input) => ({ type: "done", output: input }));

    const run = await runAsyncActionOnce({
      runId: "run-1",
      action,
      input: "hello",
      context: createContext()
    });

    expect(run.status).toBe("failed");
    expect(run.error).toBeInstanceOf(Error);
    expect(String(run.error)).toContain("Unsupported action mode");
  });

  it("treats yield as unsupported for async actions and saves state", async () => {
    const action = createAsyncAction(async () => ({
      type: "yield",
      state: { cursor: 1 }
    }));

    const run = await runAsyncActionOnce({
      runId: "run-1",
      action,
      input: "hello",
      context: createContext()
    });

    expect(run.status).toBe("failed");
    expect(run.state).toEqual({ cursor: 1 });
    expect(run.error).toBeInstanceOf(Error);
    expect(String(run.error)).toContain("Unsupported result type");
  });
});

describe("resumeActionRun", () => {
  it("starts and advances a sliceable action on first resume", async () => {
    const action = createCounterAction(1);
    const initialRun = createActionRun({ id: "run-1", actionId: action.id, input: 0 });

    const run = await resumeActionRun({
      run: initialRun,
      action,
      context: createContext()
    });

    expect(run.status).toBe("done");
    expect(run.output).toBe(1);
  });

  it("keeps state after yield", async () => {
    const action = createCounterAction(2);
    const initialRun = createActionRun({ id: "run-1", actionId: action.id, input: 0 });

    const run = await resumeActionRun({
      run: initialRun,
      action,
      context: createContext()
    });

    expect(run.status).toBe("ready");
    expect(run.state).toEqual({ count: 1 });
  });

  it("omits undefined optional fields after yield", async () => {
    const action = createCounterAction(2);
    const initialRun = createActionRun({ id: "run-1", actionId: action.id, input: 0 });

    const run = await resumeActionRun({
      run: initialRun,
      action,
      context: createContext()
    });

    expect(run.status).toBe("ready");
    expect(Object.prototype.hasOwnProperty.call(run, "output")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(run, "error")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(run, "waitReason")).toBe(false);
  });

  it("finishes after multiple resumes", async () => {
    const action = createCounterAction(2);
    const initialRun = createActionRun({ id: "run-1", actionId: action.id, input: 0 });
    const firstRun = await resumeActionRun({
      run: initialRun,
      action,
      context: createContext()
    });

    const secondRun = await resumeActionRun({
      run: firstRun,
      action,
      context: createContext()
    });

    expect(secondRun.status).toBe("done");
    expect(secondRun.output).toBe(2);
  });

  it("saves state and wait reason", async () => {
    const action: ActionDefinition<string, string, { cursor: number }> = {
      id: "wait",
      version: "1.0.0",
      mode: "sliceable",
      inputSchema: undefined,
      outputSchema: undefined,
      stateSchema: undefined,
      sideEffects: [],
      start: () => ({ cursor: 1 }),
      resume: (state) => ({ type: "waiting", state, reason: "external-event" })
    };

    const run = await resumeActionRun({
      run: createActionRun({ id: "run-1", actionId: action.id, input: "hello" }),
      action,
      context: createContext()
    });

    expect(run.status).toBe("waiting");
    expect(run.state).toEqual({ cursor: 1 });
    expect(run.waitReason).toBe("external-event");
  });

  it("records failed results", async () => {
    const error = new Error("slice failed");
    const action: ActionDefinition<string, string, { cursor: number }> = {
      id: "fail",
      version: "1.0.0",
      mode: "sliceable",
      inputSchema: undefined,
      outputSchema: undefined,
      stateSchema: undefined,
      sideEffects: [],
      start: () => ({ cursor: 1 }),
      resume: () => ({ type: "failed", error })
    };

    const run = await resumeActionRun({
      run: createActionRun({ id: "run-1", actionId: action.id, input: "hello" }),
      action,
      context: createContext()
    });

    expect(run.status).toBe("failed");
    expect(run.error).toBe(error);
  });

  it("fails explicitly for non-sliceable actions", async () => {
    const action = createInstantAction((input) => ({ type: "done", output: input }));

    const run = await resumeActionRun({
      run: createActionRun({ id: "run-1", actionId: action.id, input: "hello" }),
      action,
      context: createContext()
    });

    expect(run.status).toBe("failed");
    expect(run.error).toBeInstanceOf(Error);
    expect(String(run.error)).toContain("Unsupported action mode");
  });

  it("fails when a sliceable action is missing start", async () => {
    const action: ActionDefinition<string, string, { cursor: number }> = {
      id: "missing-start",
      version: "1.0.0",
      mode: "sliceable",
      inputSchema: undefined,
      outputSchema: undefined,
      stateSchema: undefined,
      sideEffects: [],
      resume: (state) => ({ type: "done", output: String(state.cursor) })
    };

    const run = await resumeActionRun({
      run: createActionRun({ id: "run-1", actionId: action.id, input: "hello" }),
      action,
      context: createContext()
    });

    expect(run.status).toBe("failed");
    expect(run.error).toBeInstanceOf(Error);
    expect(String(run.error)).toContain("missing start");
  });

  it("fails when a sliceable action is missing resume", async () => {
    const action: ActionDefinition<string, string, { cursor: number }> = {
      id: "missing-resume",
      version: "1.0.0",
      mode: "sliceable",
      inputSchema: undefined,
      outputSchema: undefined,
      stateSchema: undefined,
      sideEffects: [],
      start: () => ({ cursor: 1 })
    };

    const run = await resumeActionRun({
      run: createActionRun({ id: "run-1", actionId: action.id, input: "hello" }),
      action,
      context: createContext()
    });

    expect(run.status).toBe("failed");
    expect(run.error).toBeInstanceOf(Error);
    expect(String(run.error)).toContain("missing resume");
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

function createAsyncAction(
  run: ActionDefinition<string, string, { cursor: number }>["run"]
): ActionDefinition<string, string, { cursor: number }> {
  return {
    id: "async-action",
    version: "1.0.0",
    mode: "async",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    run
  };
}
