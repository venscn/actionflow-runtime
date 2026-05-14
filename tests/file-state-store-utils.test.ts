import { describe, expect, it } from "vitest";
import { assertJsonSerializable, createEnvelope, parseEnvelope, safeFileName } from "../src/index.js";

describe("safeFileName", () => {
  it("generates a non-empty string for a regular id", () => {
    expect(safeFileName("action-run-1")).toEqual(expect.any(String));
    expect(safeFileName("action-run-1").length).toBeGreaterThan(0);
  });

  it("escapes unsafe file name characters", () => {
    const unsafe = 'a/b\\c:d*e?f"g<h>i|j';
    const result = safeFileName(unsafe);

    expect(result).not.toMatch(/[\/\\:*?"<>|]/);
  });

  it("is deterministic", () => {
    expect(safeFileName("same-id")).toBe(safeFileName("same-id"));
  });

  it("throws for an empty string", () => {
    expect(() => safeFileName("")).toThrow("id must be a non-empty string");
  });
});

describe("assertJsonSerializable", () => {
  it("accepts JSON-compatible objects", () => {
    expect(() =>
      assertJsonSerializable({
        state: null,
        text: "hello",
        count: 1,
        active: true,
        items: [{ value: "ok" }]
      })
    ).not.toThrow();
  });

  it("rejects undefined, function, symbol, and bigint", () => {
    expect(() => assertJsonSerializable({ state: undefined })).toThrow("$.state");
    expect(() => assertJsonSerializable({ state: () => undefined })).toThrow("$.state");
    expect(() => assertJsonSerializable({ state: Symbol("x") })).toThrow("$.state");
    expect(() => assertJsonSerializable({ state: 1n })).toThrow("$.state");
  });

  it("rejects NaN and Infinity", () => {
    expect(() => assertJsonSerializable({ count: Number.NaN })).toThrow("$.count");
    expect(() => assertJsonSerializable({ count: Number.POSITIVE_INFINITY })).toThrow("$.count");
  });

  it("rejects Date, Error, class instances, Map, and Set", () => {
    class CustomValue {
      value = "x";
    }

    expect(() => assertJsonSerializable({ value: new Date() })).toThrow("$.value");
    expect(() => assertJsonSerializable({ error: new Error("bad") })).toThrow("$.error");
    expect(() => assertJsonSerializable({ value: new CustomValue() })).toThrow("$.value");
    expect(() => assertJsonSerializable({ value: new Map() })).toThrow("$.value");
    expect(() => assertJsonSerializable({ value: new Set() })).toThrow("$.value");
  });

  it("rejects circular references", () => {
    const value: { self?: unknown } = {};
    value.self = value;

    expect(() => assertJsonSerializable(value)).toThrow("$.self");
  });

  it("includes nested paths in error messages", () => {
    expect(() => assertJsonSerializable({ items: [undefined] })).toThrow("$.items[0]");
  });
});

describe("createEnvelope", () => {
  it("creates an actionRun envelope", () => {
    const envelope = createEnvelope("actionRun", { id: "run-1" });

    expect(envelope).toMatchObject({
      schemaVersion: 1,
      kind: "actionRun",
      data: { id: "run-1" }
    });
    expect(new Date(envelope.savedAt).toString()).not.toBe("Invalid Date");
  });

  it("creates a flowRun envelope", () => {
    const envelope = createEnvelope("flowRun", { id: "flow-run-1" });

    expect(envelope).toMatchObject({
      schemaVersion: 1,
      kind: "flowRun",
      data: { id: "flow-run-1" }
    });
  });

  it("rejects non-serializable data", () => {
    expect(() => createEnvelope("actionRun", { state: undefined })).toThrow("$.state");
  });

  it("rejects invalid kinds", () => {
    expect(() => createEnvelope("bad" as never, { id: "run-1" })).toThrow("Invalid file store record kind");
  });
});

describe("parseEnvelope", () => {
  it("accepts a valid envelope", () => {
    const envelope = createEnvelope("actionRun", { id: "run-1" });

    expect(parseEnvelope<{ id: string }>(envelope, "actionRun")).toBe(envelope);
  });

  it("rejects non-object raw values", () => {
    expect(() => parseEnvelope("bad", "actionRun")).toThrow("Invalid file store envelope");
  });

  it("rejects schemaVersion mismatches", () => {
    expect(() =>
      parseEnvelope(
        {
          schemaVersion: 2,
          kind: "actionRun",
          savedAt: new Date().toISOString(),
          data: {}
        },
        "actionRun"
      )
    ).toThrow("Unsupported schemaVersion");
  });

  it("rejects kind mismatches", () => {
    expect(() => parseEnvelope(createEnvelope("flowRun", { id: "flow-run-1" }), "actionRun")).toThrow(
      "Unexpected record kind"
    );
  });

  it("rejects non-string savedAt", () => {
    expect(() =>
      parseEnvelope(
        {
          schemaVersion: 1,
          kind: "actionRun",
          savedAt: 123,
          data: {}
        },
        "actionRun"
      )
    ).toThrow("Invalid savedAt");
  });

  it("rejects missing data", () => {
    expect(() =>
      parseEnvelope(
        {
          schemaVersion: 1,
          kind: "actionRun",
          savedAt: new Date().toISOString()
        },
        "actionRun"
      )
    ).toThrow("Missing data");
  });

  it("rejects non-serializable data", () => {
    expect(() =>
      parseEnvelope(
        {
          schemaVersion: 1,
          kind: "actionRun",
          savedAt: new Date().toISOString(),
          data: { state: undefined }
        },
        "actionRun"
      )
    ).toThrow("$.state");
  });
});
