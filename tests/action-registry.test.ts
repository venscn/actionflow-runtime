import { describe, expect, it } from "vitest";
import { ActionRegistry } from "../src/index.js";
import type { ActionDefinition } from "../src/index.js";

function createAction(id: string, version: string): ActionDefinition<string, string, never> {
  return {
    id,
    version,
    mode: "instant",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    run(input) {
      return { type: "done", output: input };
    }
  };
}

describe("ActionRegistry", () => {
  it("can register an action", () => {
    const registry = new ActionRegistry();
    const action = createAction("echo", "1.0.0");

    registry.register(action);

    expect(registry.list()).toEqual([action]);
  });

  it("can read an action", () => {
    const registry = new ActionRegistry();
    const action = createAction("echo", "1.0.0");

    registry.register(action);

    expect(registry.get("echo")).toBe(action);
  });

  it("can read an action by id and version", () => {
    const registry = new ActionRegistry();
    const first = createAction("echo", "1.0.0");
    const second = createAction("echo", "2.0.0");

    registry.register(first);
    registry.register(second);

    expect(registry.get("echo", "1.0.0")).toBe(first);
    expect(registry.get("echo", "2.0.0")).toBe(second);
  });

  it("returns the latest version by default", () => {
    const registry = new ActionRegistry();
    const older = createAction("echo", "1.9.0");
    const newer = createAction("echo", "1.10.0");

    registry.register(older);
    registry.register(newer);

    expect(registry.get("echo")).toBe(newer);
  });

  it("can check whether an action exists", () => {
    const registry = new ActionRegistry();
    const action = createAction("echo", "1.0.0");

    registry.register(action);

    expect(registry.has("echo")).toBe(true);
    expect(registry.has("echo", "1.0.0")).toBe(true);
    expect(registry.has("echo", "2.0.0")).toBe(false);
  });

  it("throws when registering duplicate id and version", () => {
    const registry = new ActionRegistry();
    const action = createAction("echo", "1.0.0");

    registry.register(action);

    expect(() => registry.register(action)).toThrow("Action already registered: echo@1.0.0");
  });

  it("returns undefined for missing actions", () => {
    const registry = new ActionRegistry();

    expect(registry.get("missing")).toBeUndefined();
    expect(registry.get("missing", "1.0.0")).toBeUndefined();
    expect(registry.get("echo", "1.0.0")).toBeUndefined();
  });
});
