import { describe, expect, it } from "vitest";
import { validatePackageManifest } from "../src/index.js";
import type { ActionFlowPackageManifest } from "../src/index.js";

describe("validatePackageManifest", () => {
  it("accepts a valid manifest", () => {
    const manifest: ActionFlowPackageManifest = {
      id: "example.package",
      name: "Example Package",
      version: "1.0.0",
      description: "Example package",
      actions: [{ id: "count.a", version: "1.0.0" }],
      flows: [{ id: "flow.basic", version: "1.0.0" }],
      rules: [{ id: "rule.start", event: "demo.started", flow: "flow.basic", enabled: true }],
      configSchema: {},
      permissions: ["console.log"]
    };

    expect(validatePackageManifest(manifest)).toEqual({
      valid: true,
      manifest
    });
  });

  it("rejects non-object manifests", () => {
    expect(validatePackageManifest(null)).toEqual({
      valid: false,
      errors: ["manifest must be an object"]
    });
  });

  it("rejects missing id, name, and version", () => {
    const result = validatePackageManifest({});

    expect(result.valid).toBe(false);
    expect(result).toMatchObject({
      errors: expect.arrayContaining([
        "id must be a non-empty string",
        "name must be a non-empty string",
        "version must be a non-empty string"
      ])
    });
  });

  it("rejects non-array actions", () => {
    const result = validatePackageManifest(createManifest({ actions: "count.a" }));

    expect(result).toEqual({
      valid: false,
      errors: ["actions must be an array"]
    });
  });

  it("rejects action refs without id", () => {
    const result = validatePackageManifest(createManifest({ actions: [{}] }));

    expect(result).toEqual({
      valid: false,
      errors: ["actions[0].id must be a non-empty string"]
    });
  });

  it("rejects non-array flows", () => {
    const result = validatePackageManifest(createManifest({ flows: "flow.basic" }));

    expect(result).toEqual({
      valid: false,
      errors: ["flows must be an array"]
    });
  });

  it("rejects flow refs without id", () => {
    const result = validatePackageManifest(createManifest({ flows: [{}] }));

    expect(result).toEqual({
      valid: false,
      errors: ["flows[0].id must be a non-empty string"]
    });
  });

  it("rejects non-array rules", () => {
    const result = validatePackageManifest(createManifest({ rules: "rule.start" }));

    expect(result).toEqual({
      valid: false,
      errors: ["rules must be an array"]
    });
  });

  it("rejects rule refs without event or flow", () => {
    const result = validatePackageManifest(createManifest({ rules: [{ id: "rule.start" }] }));

    expect(result).toEqual({
      valid: false,
      errors: [
        "rules[0].event must be a non-empty string",
        "rules[0].flow must be a non-empty string"
      ]
    });
  });

  it("rejects non-string permissions", () => {
    const result = validatePackageManifest(createManifest({ permissions: ["console.log", 123] }));

    expect(result).toEqual({
      valid: false,
      errors: ["permissions[1] must be a string"]
    });
  });

  it("returns multiple errors for invalid manifests", () => {
    const result = validatePackageManifest({
      id: "",
      name: "",
      version: "",
      actions: [{}],
      flows: [{}],
      rules: [{ id: "", enabled: "yes" }],
      permissions: [false]
    });

    expect(result.valid).toBe(false);
    expect(result).toMatchObject({
      errors: expect.arrayContaining([
        "id must be a non-empty string",
        "name must be a non-empty string",
        "version must be a non-empty string",
        "actions[0].id must be a non-empty string",
        "flows[0].id must be a non-empty string",
        "rules[0].id must be a non-empty string",
        "rules[0].event must be a non-empty string",
        "rules[0].flow must be a non-empty string",
        "rules[0].enabled must be a boolean",
        "permissions[0] must be a string"
      ])
    });
  });
});

function createManifest(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "example.package",
    name: "Example Package",
    version: "1.0.0",
    ...overrides
  };
}
