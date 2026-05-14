import { describe, expect, it } from "vitest";
import { EventTriggerRegistry, validateEventTrigger } from "../src/index.js";
import type { EventTriggerDefinition } from "../src/index.js";

describe("validateEventTrigger", () => {
  it("accepts a valid trigger", () => {
    const trigger: EventTriggerDefinition = {
      id: "trigger.created",
      event: "record.created",
      flow: "flow.process-record",
      enabled: true,
      description: "Runs when a record is created",
      filter: { type: "customer" },
      input: { source: "event" }
    };

    expect(validateEventTrigger(trigger)).toEqual({
      valid: true,
      trigger
    });
  });

  it("rejects non-object triggers", () => {
    expect(validateEventTrigger(null)).toEqual({
      valid: false,
      errors: ["trigger must be an object"]
    });
  });

  it("rejects missing id, event, and flow", () => {
    const result = validateEventTrigger({});

    expect(result.valid).toBe(false);
    expect(result).toMatchObject({
      errors: expect.arrayContaining([
        "id must be a non-empty string",
        "event must be a non-empty string",
        "flow must be a non-empty string"
      ])
    });
  });

  it("rejects empty id, event, and flow", () => {
    const result = validateEventTrigger({
      id: "",
      event: " ",
      flow: ""
    });

    expect(result.valid).toBe(false);
    expect(result).toMatchObject({
      errors: expect.arrayContaining([
        "id must be a non-empty string",
        "event must be a non-empty string",
        "flow must be a non-empty string"
      ])
    });
  });

  it("rejects non-boolean enabled", () => {
    expect(validateEventTrigger(createTrigger({ enabled: "yes" }))).toEqual({
      valid: false,
      errors: ["enabled must be a boolean"]
    });
  });

  it("rejects non-string description", () => {
    expect(validateEventTrigger(createTrigger({ description: 123 }))).toEqual({
      valid: false,
      errors: ["description must be a string"]
    });
  });

  it("returns multiple errors for invalid triggers", () => {
    const result = validateEventTrigger({
      id: "",
      event: "",
      flow: "",
      enabled: "yes",
      description: 123
    });

    expect(result.valid).toBe(false);
    expect(result).toMatchObject({
      errors: expect.arrayContaining([
        "id must be a non-empty string",
        "event must be a non-empty string",
        "flow must be a non-empty string",
        "enabled must be a boolean",
        "description must be a string"
      ])
    });
  });

  it("accepts any filter and input structure", () => {
    const trigger = createTrigger({
      filter: [{ any: ["shape"] }],
      input: () => "not validated yet"
    });

    expect(validateEventTrigger(trigger)).toEqual({
      valid: true,
      trigger
    });
  });
});

describe("EventTriggerRegistry", () => {
  it("registers and gets a trigger", () => {
    const registry = new EventTriggerRegistry();
    const trigger = createTypedTrigger({ id: "trigger.created" });

    registry.register(trigger);

    expect(registry.get("trigger.created")).toBe(trigger);
  });

  it("throws when registering duplicate ids", () => {
    const registry = new EventTriggerRegistry();
    const trigger = createTypedTrigger({ id: "trigger.created" });

    registry.register(trigger);

    expect(() => registry.register(trigger)).toThrow("Event trigger already registered: trigger.created");
  });

  it("throws with all validation errors for invalid triggers", () => {
    const registry = new EventTriggerRegistry();
    const trigger = {
      id: "",
      event: "",
      flow: "",
      enabled: "yes",
      description: 123
    } as unknown as EventTriggerDefinition;

    expect(() => registry.register(trigger)).toThrow(
      "Invalid event trigger: id must be a non-empty string; event must be a non-empty string; flow must be a non-empty string; enabled must be a boolean; description must be a string"
    );
  });

  it("checks whether a trigger exists", () => {
    const registry = new EventTriggerRegistry();
    const trigger = createTypedTrigger({ id: "trigger.created" });

    registry.register(trigger);

    expect(registry.has("trigger.created")).toBe(true);
    expect(registry.has("missing")).toBe(false);
  });

  it("lists all triggers", () => {
    const registry = new EventTriggerRegistry();
    const first = createTypedTrigger({ id: "trigger.created" });
    const second = createTypedTrigger({ id: "trigger.updated", event: "record.updated" });

    registry.register(first);
    registry.register(second);

    expect(registry.list()).toEqual([first, second]);
  });

  it("does not list disabled triggers as enabled", () => {
    const registry = new EventTriggerRegistry();
    const enabled = createTypedTrigger({ id: "trigger.created" });
    const disabled = createTypedTrigger({ id: "trigger.disabled", enabled: false });

    registry.register(enabled);
    registry.register(disabled);

    expect(registry.listEnabled()).toEqual([enabled]);
  });

  it("treats missing enabled as enabled", () => {
    const registry = new EventTriggerRegistry();
    const trigger = createTypedTrigger({ id: "trigger.created", enabled: undefined });

    registry.register(trigger);

    expect(registry.listEnabled()).toEqual([trigger]);
  });

  it("finds triggers by exact event", () => {
    const registry = new EventTriggerRegistry();
    const first = createTypedTrigger({ id: "trigger.created.1", event: "record.created" });
    const second = createTypedTrigger({ id: "trigger.created.2", event: "record.created", enabled: false });
    const third = createTypedTrigger({ id: "trigger.updated", event: "record.updated" });

    registry.register(first);
    registry.register(second);
    registry.register(third);

    expect(registry.findByEvent("record.created")).toEqual([first, second]);
  });

  it("deletes triggers", () => {
    const registry = new EventTriggerRegistry();
    const trigger = createTypedTrigger({ id: "trigger.created" });

    registry.register(trigger);

    expect(registry.delete("trigger.created")).toBe(true);
    expect(registry.delete("trigger.created")).toBe(false);
    expect(registry.get("trigger.created")).toBeUndefined();
  });

  it("clears all triggers", () => {
    const registry = new EventTriggerRegistry();

    registry.register(createTypedTrigger({ id: "trigger.created" }));
    registry.register(createTypedTrigger({ id: "trigger.updated", event: "record.updated" }));
    registry.clear();

    expect(registry.list()).toEqual([]);
  });
});

function createTrigger(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "trigger.created",
    event: "record.created",
    flow: "flow.process-record",
    ...overrides
  };
}

function createTypedTrigger(overrides: Partial<EventTriggerDefinition>): EventTriggerDefinition {
  return {
    id: "trigger.created",
    event: "record.created",
    flow: "flow.process-record",
    ...overrides
  };
}
