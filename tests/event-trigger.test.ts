import { describe, expect, it } from "vitest";
import { validateEventTrigger } from "../src/index.js";
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

function createTrigger(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "trigger.created",
    event: "record.created",
    flow: "flow.process-record",
    ...overrides
  };
}
