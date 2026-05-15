import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  assertJsonSerializable,
  createBatchManifest,
  createBatchTargetFiles,
  createFileStoreBatchId,
  parseBatchManifest
} from "../src/index.js";

describe("createFileStoreBatchId", () => {
  it("returns a non-empty string", () => {
    expect(createFileStoreBatchId()).toEqual(expect.any(String));
    expect(createFileStoreBatchId().length).toBeGreaterThan(0);
  });

  it("does not contain unsafe file name characters", () => {
    expect(createFileStoreBatchId()).not.toMatch(/[\/\\:*?"<>|]/);
  });

  it("generates different ids across consecutive calls", () => {
    expect(createFileStoreBatchId()).not.toBe(createFileStoreBatchId());
  });

  it("throws for an invalid Date", () => {
    expect(() => createFileStoreBatchId(new Date(Number.NaN))).toThrow("Invalid Date");
  });
});

describe("createBatchManifest", () => {
  it("creates a default pending manifest", () => {
    const now = new Date("2026-05-15T00:00:00.000Z");
    const manifest = createBatchManifest({ now });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      kind: "runBatch",
      createdAt: "2026-05-15T00:00:00.000Z",
      status: "pending",
      actionRunIds: [],
      targetFiles: []
    });
    expect(manifest.batchId).toEqual(expect.any(String));
  });

  it("supports explicit fields", () => {
    const manifest = createBatchManifest({
      batchId: "batch-1",
      status: "committed",
      flowRunId: "flow-run-1",
      actionRunIds: ["flow-run-1:node-1"],
      targetFiles: ["flow-runs/flow.json", "action-runs/action.json"],
      now: new Date("2026-05-15T00:00:00.000Z")
    });

    expect(manifest).toEqual({
      schemaVersion: 1,
      kind: "runBatch",
      batchId: "batch-1",
      createdAt: "2026-05-15T00:00:00.000Z",
      status: "committed",
      flowRunId: "flow-run-1",
      actionRunIds: ["flow-run-1:node-1"],
      targetFiles: ["flow-runs/flow.json", "action-runs/action.json"]
    });
  });

  it("rejects invalid status", () => {
    expect(() => createBatchManifest({ status: "bad" as never })).toThrow("Invalid batch status");
  });

  it("rejects invalid batchId", () => {
    expect(() => createBatchManifest({ batchId: "" })).toThrow("Invalid batchId");
  });

  it("rejects invalid flowRunId", () => {
    expect(() => createBatchManifest({ flowRunId: "" })).toThrow("Invalid flowRunId");
  });

  it("rejects invalid actionRunIds", () => {
    expect(() => createBatchManifest({ actionRunIds: ["ok", ""] })).toThrow("Invalid actionRunIds");
  });

  it("rejects invalid targetFiles", () => {
    expect(() => createBatchManifest({ targetFiles: [path.resolve("flow-runs/run.json")] })).toThrow(
      "Invalid targetFiles"
    );
    expect(() => createBatchManifest({ targetFiles: ["flow-runs/../run.json"] })).toThrow("Invalid targetFiles");
  });

  it("creates JSON-compatible manifests", () => {
    expect(() =>
      assertJsonSerializable(
        createBatchManifest({
          flowRunId: "flow-run-1",
          actionRunIds: ["flow-run-1:node-1"],
          targetFiles: ["flow-runs/run.json"]
        })
      )
    ).not.toThrow();
  });
});

describe("parseBatchManifest", () => {
  it("accepts a valid manifest", () => {
    const manifest = createBatchManifest({ batchId: "batch-1" });

    expect(parseBatchManifest(manifest)).toBe(manifest);
  });

  it("rejects non-object raw values", () => {
    expect(() => parseBatchManifest("bad")).toThrow("Invalid file store batch manifest");
  });

  it("rejects schemaVersion mismatches", () => {
    expect(() =>
      parseBatchManifest({
        ...createBatchManifest(),
        schemaVersion: 2
      })
    ).toThrow("Unsupported batch manifest schemaVersion");
  });

  it("rejects kind mismatches", () => {
    expect(() =>
      parseBatchManifest({
        ...createBatchManifest(),
        kind: "other"
      })
    ).toThrow("Unexpected batch manifest kind");
  });

  it("rejects invalid batchId", () => {
    expect(() =>
      parseBatchManifest({
        ...createBatchManifest(),
        batchId: ""
      })
    ).toThrow("Invalid batchId");
  });

  it("rejects invalid status", () => {
    expect(() =>
      parseBatchManifest({
        ...createBatchManifest(),
        status: "bad"
      })
    ).toThrow("Invalid batch status");
  });

  it("rejects invalid actionRunIds", () => {
    expect(() =>
      parseBatchManifest({
        ...createBatchManifest(),
        actionRunIds: ["ok", ""]
      })
    ).toThrow("Invalid actionRunIds");
  });

  it("rejects invalid targetFiles", () => {
    expect(() =>
      parseBatchManifest({
        ...createBatchManifest(),
        targetFiles: ["flow-runs/../run.json"]
      })
    ).toThrow("Invalid targetFiles");
  });

  it("rejects invalid flowRunId", () => {
    expect(() =>
      parseBatchManifest({
        ...createBatchManifest(),
        flowRunId: ""
      })
    ).toThrow("Invalid flowRunId");
  });
});

describe("createBatchTargetFiles", () => {
  it("creates safe relative targets for flow and action runs", () => {
    expect(
      createBatchTargetFiles({
        flowRunId: "flow-run-1",
        actionRunIds: ["flow-run-1:node-1", "flow-run-1:node-2"]
      })
    ).toEqual([
      "flow-runs/Zmxvdy1ydW4tMQ.json",
      "action-runs/Zmxvdy1ydW4tMTpub2RlLTE.json",
      "action-runs/Zmxvdy1ydW4tMTpub2RlLTI.json"
    ]);
  });

  it("creates safe paths for unsafe ids", () => {
    const targets = createBatchTargetFiles({
      flowRunId: 'a/b\\c:d*e?f"g<h>i|j',
      actionRunIds: ['x/y\\z:q*r?s"t<u>v|w']
    });

    expect(targets).toHaveLength(2);
    for (const target of targets) {
      expect(target).not.toMatch(/[\\:*?"<>|]/);
      expect(target.split("/")).not.toContain("..");
    }
  });
});
