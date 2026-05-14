import { describe, expect, it } from "vitest";
import { ActionRegistry, FlowRegistry, checkPackageManifestRegistries, validatePackageManifest } from "../src/index.js";
import type { ActionDefinition, ActionFlowPackageManifest, FlowDefinition } from "../src/index.js";

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

describe("checkPackageManifestRegistries", () => {
  it("returns valid when all manifest actions exist", () => {
    const actions = new ActionRegistry();
    actions.register(createAction("text.uppercase", "1.0.0"));

    expect(
      checkPackageManifestRegistries({
        manifest: createTypedManifest({ actions: [{ id: "text.uppercase" }] }),
        actions
      })
    ).toEqual({ valid: true });
  });

  it("returns valid when all manifest flows exist", () => {
    const flows = new FlowRegistry();
    flows.register(createFlow("flow.basic", "1.0.0"));

    expect(
      checkPackageManifestRegistries({
        manifest: createTypedManifest({ flows: [{ id: "flow.basic" }] }),
        flows
      })
    ).toEqual({ valid: true });
  });

  it("returns missing action errors", () => {
    const actions = new ActionRegistry();

    expect(
      checkPackageManifestRegistries({
        manifest: createTypedManifest({ actions: [{ id: "text.uppercase" }] }),
        actions
      })
    ).toEqual({
      valid: false,
      errors: ["Missing action: text.uppercase"]
    });
  });

  it("returns missing flow errors", () => {
    const flows = new FlowRegistry();

    expect(
      checkPackageManifestRegistries({
        manifest: createTypedManifest({ flows: [{ id: "flow.basic" }] }),
        flows
      })
    ).toEqual({
      valid: false,
      errors: ["Missing flow: flow.basic"]
    });
  });

  it("checks exact versions for action and flow refs", () => {
    const actions = new ActionRegistry();
    const flows = new FlowRegistry();
    actions.register(createAction("text.uppercase", "2.0.0"));
    flows.register(createFlow("flow.basic", "2.0.0"));

    expect(
      checkPackageManifestRegistries({
        manifest: createTypedManifest({
          actions: [{ id: "text.uppercase", version: "1.0.0" }],
          flows: [{ id: "flow.basic", version: "1.0.0" }]
        }),
        actions,
        flows
      })
    ).toEqual({
      valid: false,
      errors: ["Missing action: text.uppercase@1.0.0", "Missing flow: flow.basic@1.0.0"]
    });
  });

  it("returns multiple missing errors", () => {
    const actions = new ActionRegistry();
    const flows = new FlowRegistry();

    expect(
      checkPackageManifestRegistries({
        manifest: createTypedManifest({
          actions: [{ id: "text.uppercase" }, { id: "text.lowercase" }],
          flows: [{ id: "flow.basic" }]
        }),
        actions,
        flows
      })
    ).toEqual({
      valid: false,
      errors: [
        "Missing action: text.uppercase",
        "Missing action: text.lowercase",
        "Missing flow: flow.basic"
      ]
    });
  });

  it("skips action checks when no action registry is provided", () => {
    expect(
      checkPackageManifestRegistries({
        manifest: createTypedManifest({ actions: [{ id: "text.uppercase" }] })
      })
    ).toEqual({ valid: true });
  });

  it("skips flow checks when no flow registry is provided", () => {
    expect(
      checkPackageManifestRegistries({
        manifest: createTypedManifest({ flows: [{ id: "flow.basic" }] })
      })
    ).toEqual({ valid: true });
  });

  it("does not check rules.flow", () => {
    const flows = new FlowRegistry();

    expect(
      checkPackageManifestRegistries({
        manifest: createTypedManifest({
          rules: [{ id: "rule.start", event: "demo.started", flow: "missing.flow" }]
        }),
        flows
      })
    ).toEqual({ valid: true });
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

function createTypedManifest(overrides: Partial<ActionFlowPackageManifest>): ActionFlowPackageManifest {
  return {
    id: "example.package",
    name: "Example Package",
    version: "1.0.0",
    ...overrides
  };
}

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
      action: "text.uppercase"
    }
  };
}
