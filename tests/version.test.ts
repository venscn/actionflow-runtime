import { describe, expect, it } from "vitest";
import { ActionRegistry, FlowRegistry, compareVersions } from "../src/index.js";
import type { ActionDefinition, FlowDefinition } from "../src/index.js";

describe("compareVersions", () => {
  it("compares patch versions", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0);
  });

  it("compares minor versions numerically", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
  });

  it("compares major versions", () => {
    expect(compareVersions("2.0.0", "1.999.999")).toBeGreaterThan(0);
  });

  it("treats missing segments as zero", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });

  it("returns zero for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("falls back to string comparison for non-numeric segments", () => {
    expect(compareVersions("1.0.beta", "1.0.alpha")).toBeGreaterThan(0);
  });
});

describe("registry version lookup", () => {
  it("keeps ActionRegistry latest-version lookup behavior", () => {
    const registry = new ActionRegistry();
    const older = createAction("echo", "1.9.0");
    const newer = createAction("echo", "1.10.0");

    registry.register(older);
    registry.register(newer);

    expect(registry.get("echo")).toBe(newer);
  });

  it("keeps FlowRegistry latest-version lookup behavior", () => {
    const registry = new FlowRegistry();
    const older = createFlow("flow.basic", "1.9.0");
    const newer = createFlow("flow.basic", "1.10.0");

    registry.register(older);
    registry.register(newer);

    expect(registry.get("flow.basic")).toBe(newer);
  });
});

function createAction(id: string, version: string): ActionDefinition<unknown, string, never> {
  return {
    id,
    version,
    mode: "instant",
    inputSchema: undefined,
    outputSchema: undefined,
    stateSchema: undefined,
    sideEffects: [],
    run: () => ({ type: "done", output: "ok" })
  };
}

function createFlow(id: string, version: string): FlowDefinition {
  return {
    id,
    version,
    root: {
      type: "action",
      id: "node-1",
      action: "echo"
    }
  };
}
