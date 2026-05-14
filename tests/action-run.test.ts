import { describe, expect, it } from "vitest";
import { runActionOnce } from "../src/index.js";
import type { ActionContext, ActionDefinition } from "../src/index.js";

function createContext(): ActionContext {
  const deadline = Date.now() + 1000;

  return {
    now: () => Date.now(),
    deadline: () => deadline,
    remainingMs: () => Math.max(0, deadline - Date.now()),
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
