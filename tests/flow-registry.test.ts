import { describe, expect, it } from "vitest";
import { FlowRegistry } from "../src/index.js";
import type { FlowDefinition } from "../src/index.js";

describe("FlowRegistry", () => {
  it("registers and gets a flow", () => {
    const registry = new FlowRegistry();
    const flow = createFlow("flow.basic", "1.0.0");

    registry.register(flow);

    expect(registry.get("flow.basic")).toBe(flow);
  });

  it("gets a flow by id and version", () => {
    const registry = new FlowRegistry();
    const first = createFlow("flow.basic", "1.0.0");
    const second = createFlow("flow.basic", "2.0.0");

    registry.register(first);
    registry.register(second);

    expect(registry.get("flow.basic", "1.0.0")).toBe(first);
    expect(registry.get("flow.basic", "2.0.0")).toBe(second);
  });

  it("returns the latest version by default", () => {
    const registry = new FlowRegistry();
    const older = createFlow("flow.basic", "1.9.0");
    const newer = createFlow("flow.basic", "1.10.0");

    registry.register(older);
    registry.register(newer);

    expect(registry.get("flow.basic")).toBe(newer);
  });

  it("checks whether a flow exists", () => {
    const registry = new FlowRegistry();
    const flow = createFlow("flow.basic", "1.0.0");

    registry.register(flow);

    expect(registry.has("flow.basic")).toBe(true);
    expect(registry.has("flow.basic", "1.0.0")).toBe(true);
    expect(registry.has("flow.basic", "2.0.0")).toBe(false);
  });

  it("lists all flows", () => {
    const registry = new FlowRegistry();
    const first = createFlow("flow.first", "1.0.0");
    const second = createFlow("flow.second", "1.0.0");

    registry.register(first);
    registry.register(second);

    expect(registry.list()).toEqual(expect.arrayContaining([first, second]));
    expect(registry.list()).toHaveLength(2);
  });

  it("throws when registering duplicate id and version", () => {
    const registry = new FlowRegistry();
    const flow = createFlow("flow.basic", "1.0.0");

    registry.register(flow);

    expect(() => registry.register(flow)).toThrow("Flow already registered: flow.basic@1.0.0");
  });

  it("throws for invalid id, version, or root", () => {
    const registry = new FlowRegistry();

    expect(() => registry.register(createFlow("", "1.0.0"))).toThrow("Flow id must be a non-empty string");
    expect(() => registry.register(createFlow("flow.basic", ""))).toThrow("Flow version must be a non-empty string");
    expect(() =>
      registry.register({
        id: "flow.basic",
        version: "1.0.0",
        root: undefined
      } as unknown as FlowDefinition)
    ).toThrow("Flow root is required");
  });

  it("deletes a specific version", () => {
    const registry = new FlowRegistry();
    const first = createFlow("flow.basic", "1.0.0");
    const second = createFlow("flow.basic", "2.0.0");

    registry.register(first);
    registry.register(second);

    expect(registry.delete("flow.basic", "1.0.0")).toBe(true);
    expect(registry.delete("flow.basic", "1.0.0")).toBe(false);
    expect(registry.get("flow.basic", "1.0.0")).toBeUndefined();
    expect(registry.get("flow.basic", "2.0.0")).toBe(second);
  });

  it("deletes all versions for an id", () => {
    const registry = new FlowRegistry();

    registry.register(createFlow("flow.basic", "1.0.0"));
    registry.register(createFlow("flow.basic", "2.0.0"));

    expect(registry.delete("flow.basic")).toBe(true);
    expect(registry.delete("flow.basic")).toBe(false);
    expect(registry.get("flow.basic")).toBeUndefined();
  });

  it("clears all flows", () => {
    const registry = new FlowRegistry();

    registry.register(createFlow("flow.first", "1.0.0"));
    registry.register(createFlow("flow.second", "1.0.0"));
    registry.clear();

    expect(registry.list()).toEqual([]);
  });
});

function createFlow(id: string, version: string): FlowDefinition {
  return {
    id,
    version,
    root: {
      type: "action",
      id: "node-1",
      action: "echo",
      input: "hello"
    }
  };
}
