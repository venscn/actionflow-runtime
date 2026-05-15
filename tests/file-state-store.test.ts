import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  ActionFlowRuntime,
  createEnvelope,
  FileStateStore,
  parseBatchManifest,
  parseEnvelope,
  safeFileName,
  supportsRunBatch
} from "../src/index.js";
import type { FileStoreBatchManifest } from "../src/index.js";
import type { ActionRunRecord, FlowRunRecord } from "../src/index.js";

describe("FileStateStore", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("saves and reads an ActionRun", () => {
    const store = createStore();
    const run = createActionRun("action-run-1", "ready");

    store.saveActionRun(run);

    expect(store.getActionRun("action-run-1")).toEqual(run);
  });

  it("overwrites an ActionRun", () => {
    const store = createStore();

    store.saveActionRun(createActionRun("action-run-1", "ready"));
    store.saveActionRun({ ...createActionRun("action-run-1", "done"), output: "ok" });

    expect(store.getActionRun("action-run-1")).toMatchObject({
      status: "done",
      output: "ok"
    });
    expect(store.listActionRuns()).toHaveLength(1);
  });

  it("lists ActionRuns", () => {
    const store = createStore();
    const first = createActionRun("action-run-1", "ready");
    const second = createActionRun("action-run-2", "done");

    store.saveActionRun(first);
    store.saveActionRun(second);

    expect(store.listActionRuns()).toEqual(expect.arrayContaining([first, second]));
    expect(store.listActionRuns()).toHaveLength(2);
  });

  it("deletes an ActionRun", () => {
    const store = createStore();

    store.saveActionRun(createActionRun("action-run-1", "ready"));

    expect(store.deleteActionRun("action-run-1")).toBe(true);
    expect(store.deleteActionRun("action-run-1")).toBe(false);
    expect(store.getActionRun("action-run-1")).toBeUndefined();
  });

  it("saves and reads a FlowRun", () => {
    const store = createStore();
    const run = createFlowRun("flow-run-1", "ready");

    store.saveFlowRun(run);

    expect(store.getFlowRun("flow-run-1")).toEqual(run);
  });

  it("overwrites a FlowRun", () => {
    const store = createStore();

    store.saveFlowRun(createFlowRun("flow-run-1", "ready"));
    store.saveFlowRun(createFlowRun("flow-run-1", "done"));

    expect(store.getFlowRun("flow-run-1")).toMatchObject({ status: "done" });
    expect(store.listFlowRuns()).toHaveLength(1);
  });

  it("lists FlowRuns", () => {
    const store = createStore();
    const first = createFlowRun("flow-run-1", "ready");
    const second = createFlowRun("flow-run-2", "done");

    store.saveFlowRun(first);
    store.saveFlowRun(second);

    expect(store.listFlowRuns()).toEqual(expect.arrayContaining([first, second]));
    expect(store.listFlowRuns()).toHaveLength(2);
  });

  it("deletes a FlowRun", () => {
    const store = createStore();

    store.saveFlowRun(createFlowRun("flow-run-1", "ready"));

    expect(store.deleteFlowRun("flow-run-1")).toBe(true);
    expect(store.deleteFlowRun("flow-run-1")).toBe(false);
    expect(store.getFlowRun("flow-run-1")).toBeUndefined();
  });

  it("clears action-runs and flow-runs", () => {
    const { rootDir, store } = createStoreWithRoot();

    store.saveActionRun(createActionRun("action-run-1", "ready"));
    store.saveFlowRun(createFlowRun("flow-run-1", "ready"));
    store.clear();

    expect(store.listActionRuns()).toEqual([]);
    expect(store.listFlowRuns()).toEqual([]);
    expect(existsSync(rootDir)).toBe(true);
  });

  it("returns undefined for missing ActionRun and FlowRun records", () => {
    const store = createStore();

    expect(store.getActionRun("missing-action-run")).toBeUndefined();
    expect(store.getFlowRun("missing-flow-run")).toBeUndefined();
  });

  it("returns empty lists when directories do not exist", () => {
    const store = createStore();

    expect(store.listActionRuns()).toEqual([]);
    expect(store.listFlowRuns()).toEqual([]);
  });

  it("saves and reads unsafe run ids", () => {
    const store = createStore();
    const unsafeId = 'a/b\\c:d*e?f"g<h>i|j';
    const run = createActionRun(unsafeId, "ready");

    store.saveActionRun(run);

    expect(store.getActionRun(unsafeId)).toEqual(run);
  });

  it("rejects non-JSON ActionRun records", () => {
    const store = createStore();
    const run = { ...createActionRun("action-run-1", "ready"), state: undefined };

    expect(() => store.saveActionRun(run)).toThrow("$.state");
  });

  it("throws when reading corrupted JSON", () => {
    const { rootDir, store } = createStoreWithRoot();
    writeManagedFile(rootDir, "action-runs", "action-run-1", "{");

    expect(() => store.getActionRun("action-run-1")).toThrow();
  });

  it("throws when reading a mismatched record kind", () => {
    const { rootDir, store } = createStoreWithRoot();
    writeManagedFile(
      rootDir,
      "action-runs",
      "action-run-1",
      JSON.stringify(createEnvelope("flowRun", createFlowRun("flow-run-1", "ready")))
    );

    expect(() => store.getActionRun("action-run-1")).toThrow("Unexpected record kind");
  });

  it("does not delete files outside the store root when clearing", () => {
    const parentDir = mkdtempSync(path.join(os.tmpdir(), "actionflow-file-store-parent-"));
    tempDirs.push(parentDir);
    const rootDir = path.join(parentDir, "store");
    const outsideFile = path.join(parentDir, "outside.txt");
    const store = new FileStateStore({ rootDir });

    writeFileSync(outsideFile, "keep", "utf8");
    store.saveActionRun(createActionRun("action-run-1", "ready"));
    store.clear();

    expect(existsSync(outsideFile)).toBe(true);
    expect(existsSync(rootDir)).toBe(true);
  });

  it("saveRunBatch saves a FlowRun and ActionRuns", () => {
    const store = createStore();
    const flowRun = createFlowRun("flow-run-1", "running");
    const firstActionRun = createActionRun("flow-run-1:node-1", "done");
    const secondActionRun = createActionRun("flow-run-1:node-2", "ready");

    store.saveRunBatch({
      flowRun,
      actionRuns: [firstActionRun, secondActionRun]
    });

    expect(store.getFlowRun("flow-run-1")).toEqual(flowRun);
    expect(store.listActionRuns()).toEqual(expect.arrayContaining([firstActionRun, secondActionRun]));
  });

  it("saveRunBatch handles a missing FlowRun", () => {
    const store = createStore();
    const actionRun = createActionRun("flow-run-1:node-1", "done");

    store.saveRunBatch({
      actionRuns: [actionRun]
    });

    expect(store.listFlowRuns()).toEqual([]);
    expect(store.getActionRun("flow-run-1:node-1")).toEqual(actionRun);
  });

  it("saveRunBatch handles missing ActionRuns", () => {
    const store = createStore();
    const flowRun = createFlowRun("flow-run-1", "running");

    store.saveRunBatch({ flowRun });

    expect(store.getFlowRun("flow-run-1")).toEqual(flowRun);
    expect(store.listActionRuns()).toEqual([]);
  });

  it("saveRunBatch handles empty ActionRuns", () => {
    const store = createStore();
    const flowRun = createFlowRun("flow-run-1", "running");

    store.saveRunBatch({
      flowRun,
      actionRuns: []
    });

    expect(store.getFlowRun("flow-run-1")).toEqual(flowRun);
    expect(store.listActionRuns()).toEqual([]);
  });

  it("supportsRunBatch returns true for FileStateStore", () => {
    expect(supportsRunBatch(createStore())).toBe(true);
  });

  it("saveRunBatch propagates non-serializable ActionRun errors", () => {
    const store = createStore();
    const actionRun = { ...createActionRun("flow-run-1:node-1", "ready"), state: undefined };

    expect(() =>
      store.saveRunBatch({
        actionRuns: [actionRun]
      })
    ).toThrow("$.state");
  });

  it("saveRunBatch writes records that restoreRun can reload", () => {
    const store = createStore();
    const runtime = new ActionFlowRuntime({ stateStore: store });

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [{ ...createActionRun("flow-run-1:node-1", "done"), output: "ok" }]
    });

    const restored = runtime.restoreRun("flow-run-1");

    expect(restored.actionRuns["node-1"]).toMatchObject({
      runId: "flow-run-1:node-1",
      output: "ok"
    });
  });

  it("saveRunBatch writes a pending batch manifest", () => {
    const { rootDir, store } = createStoreWithRoot();
    const flowRun = createFlowRun("flow-run-1", "running");
    const actionRun = createActionRun("flow-run-1:node-1", "done");

    store.saveRunBatch({
      flowRun,
      actionRuns: [actionRun]
    });

    const manifest = readOnlyPendingBatchManifest(rootDir);

    expect(manifest).toMatchObject({
      status: "pending",
      flowRunId: "flow-run-1",
      actionRunIds: ["flow-run-1:node-1"]
    });
    expect(manifest.targetFiles).toEqual([
      `flow-runs/${safeFileName("flow-run-1")}.json`,
      `action-runs/${safeFileName("flow-run-1:node-1")}.json`
    ]);
  });

  it("saveRunBatch writes pending manifest before records", () => {
    const { rootDir, store } = createStoreWithRoot();
    const invalidActionRun = { ...createActionRun("flow-run-1:node-1", "ready"), state: undefined };

    expect(() =>
      store.saveRunBatch({
        flowRun: createFlowRun("flow-run-1", "running"),
        actionRuns: [invalidActionRun]
      })
    ).toThrow("$.state");

    expect(listPendingBatchManifestFiles(rootDir)).toHaveLength(1);
  });

  it("saveRunBatch manifest uses safe paths for unsafe ids", () => {
    const { rootDir, store } = createStoreWithRoot();
    const unsafeFlowRunId = 'a/b\\c:d*e?f"g<h>i|j';
    const unsafeActionRunId = 'x/y\\z:q*r?s"t<u>v|w';

    store.saveRunBatch({
      flowRun: createFlowRun(unsafeFlowRunId, "running"),
      actionRuns: [createActionRun(unsafeActionRunId, "done")]
    });

    const manifest = readOnlyPendingBatchManifest(rootDir);

    for (const targetFile of manifest.targetFiles) {
      const segments = targetFile.split("/");

      expect(segments).not.toContain("..");
      for (const segment of segments) {
        expect(segment).not.toMatch(/[\\:*?"<>|]/);
      }
    }
  });

  it("clear removes batch manifests but not rootDir", () => {
    const { rootDir, store } = createStoreWithRoot();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });

    expect(listPendingBatchManifestFiles(rootDir)).toHaveLength(1);

    store.clear();

    expect(existsSync(rootDir)).toBe(true);
    expect(listPendingBatchManifestFiles(rootDir)).toEqual([]);
  });

  it("saveRunBatch writes staging records for FlowRun and ActionRuns", () => {
    const { rootDir, store } = createStoreWithRoot();
    const flowRun = createFlowRun("flow-run-1", "running");
    const firstActionRun = createActionRun("flow-run-1:node-1", "done");
    const secondActionRun = createActionRun("flow-run-1:node-2", "ready");

    store.saveRunBatch({
      flowRun,
      actionRuns: [firstActionRun, secondActionRun]
    });

    const manifest = readOnlyPendingBatchManifest(rootDir);
    const recordsDir = pendingBatchRecordsDir(rootDir, manifest);
    const flowRunPath = path.join(recordsDir, "flow-runs", `${safeFileName("flow-run-1")}.json`);
    const firstActionRunPath = path.join(recordsDir, "action-runs", `${safeFileName("flow-run-1:node-1")}.json`);
    const secondActionRunPath = path.join(recordsDir, "action-runs", `${safeFileName("flow-run-1:node-2")}.json`);

    expect(parseEnvelope(readJson(flowRunPath), "flowRun").data).toEqual(flowRun);
    expect(parseEnvelope(readJson(firstActionRunPath), "actionRun").data).toEqual(firstActionRun);
    expect(parseEnvelope(readJson(secondActionRunPath), "actionRun").data).toEqual(secondActionRun);
  });

  it("saveRunBatch validates staging records before final writes", () => {
    const { rootDir, store } = createStoreWithRoot();
    const invalidActionRun = { ...createActionRun("flow-run-1:node-1", "ready"), state: undefined };

    expect(() =>
      store.saveRunBatch({
        flowRun: createFlowRun("flow-run-1", "running"),
        actionRuns: [invalidActionRun]
      })
    ).toThrow("$.state");

    const manifest = readOnlyPendingBatchManifest(rootDir);
    const recordsDir = pendingBatchRecordsDir(rootDir, manifest);

    expect(store.getActionRun("flow-run-1:node-1")).toBeUndefined();
    expect(existsSync(path.join(recordsDir, "action-runs", `${safeFileName("flow-run-1:node-1")}.json`))).toBe(false);
  });

  it("staging records use safe paths for unsafe ids", () => {
    const { rootDir, store } = createStoreWithRoot();
    const unsafeFlowRunId = 'a/b\\c:d*e?f"g<h>i|j';
    const unsafeActionRunId = 'x/y\\z:q*r?s"t<u>v|w';

    store.saveRunBatch({
      flowRun: createFlowRun(unsafeFlowRunId, "running"),
      actionRuns: [createActionRun(unsafeActionRunId, "done")]
    });

    const manifest = readOnlyPendingBatchManifest(rootDir);
    const recordsDir = pendingBatchRecordsDir(rootDir, manifest);
    const recordFiles = listStagingRecordFiles(recordsDir);

    expect(recordFiles).toHaveLength(2);
    for (const recordFile of recordFiles) {
      const relativePath = path.relative(recordsDir, recordFile);
      const segments = relativePath.split(path.sep);

      expect(segments).not.toContain("..");
      for (const segment of segments) {
        expect(segment).not.toMatch(/[\\:*?"<>|]/);
      }
    }

    expect(parseEnvelope(readJson(path.join(recordsDir, "flow-runs", `${safeFileName(unsafeFlowRunId)}.json`)), "flowRun").data).toMatchObject({
      id: unsafeFlowRunId
    });
    expect(
      parseEnvelope(readJson(path.join(recordsDir, "action-runs", `${safeFileName(unsafeActionRunId)}.json`)), "actionRun")
        .data
    ).toMatchObject({
      runId: unsafeActionRunId
    });
  });

  it("clear removes staging records and pending manifests", () => {
    const { rootDir, store } = createStoreWithRoot();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });

    const manifest = readOnlyPendingBatchManifest(rootDir);
    const recordsDir = pendingBatchRecordsDir(rootDir, manifest);

    expect(existsSync(recordsDir)).toBe(true);
    expect(listStagingRecordFiles(recordsDir)).toHaveLength(2);

    store.clear();

    expect(existsSync(rootDir)).toBe(true);
    expect(store.listPendingBatches()).toEqual([]);
    expect(existsSync(recordsDir)).toBe(false);
  });

  it("listPendingBatches still lists pending manifests after staging records are added", () => {
    const store = createStore();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });

    const [batch] = store.listPendingBatches();

    expect(batch.manifest.status).toBe("pending");
    expect(batch.manifest.flowRunId).toBe("flow-run-1");
    expect(batch.manifest.actionRunIds).toEqual(["flow-run-1:node-1"]);
  });

  it("saveRunBatch writes committed marker after successful target writes", () => {
    const { rootDir, store } = createStoreWithRoot();
    const flowRun = createFlowRun("flow-run-1", "running");
    const actionRun = createActionRun("flow-run-1:node-1", "done");

    store.saveRunBatch({
      flowRun,
      actionRuns: [actionRun]
    });

    const [batch] = store.listCommittedBatches();

    expect(batch.manifest).toMatchObject({
      status: "committed",
      flowRunId: "flow-run-1",
      actionRunIds: ["flow-run-1:node-1"]
    });
    expect(batch.manifest.targetFiles).toEqual([
      `flow-runs/${safeFileName("flow-run-1")}.json`,
      `action-runs/${safeFileName("flow-run-1:node-1")}.json`
    ]);
    expect(readOnlyCommittedBatchManifest(rootDir)).toEqual(batch.manifest);
    expect(store.getFlowRun("flow-run-1")).toEqual(flowRun);
    expect(store.getActionRun("flow-run-1:node-1")).toEqual(actionRun);
  });

  it("saveRunBatch does not write committed marker when staging validation fails", () => {
    const { rootDir, store } = createStoreWithRoot();
    const invalidActionRun = { ...createActionRun("flow-run-1:node-1", "ready"), state: undefined };

    expect(() =>
      store.saveRunBatch({
        flowRun: createFlowRun("flow-run-1", "running"),
        actionRuns: [invalidActionRun]
      })
    ).toThrow("$.state");

    expect(listPendingBatchManifestFiles(rootDir)).toHaveLength(1);
    expect(store.listCommittedBatches()).toEqual([]);
  });

  it("listCommittedBatches returns an empty list when committed directory is missing", () => {
    const store = createStore();

    expect(store.listCommittedBatches()).toEqual([]);
  });

  it("listCommittedBatches returns committed markers in deterministic order", () => {
    const store = createStore();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-2", "running"),
      actionRuns: [createActionRun("flow-run-2:node-1", "done")]
    });
    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });

    const batches = store.listCommittedBatches();
    const paths = batches.map((batch) => batch.path);

    expect(batches).toHaveLength(2);
    expect(paths).toEqual([...paths].sort());
    expect(batches.map((batch) => batch.manifest.status)).toEqual(["committed", "committed"]);
  });

  it("listCommittedBatches throws on corrupted JSON", () => {
    const { rootDir, store } = createStoreWithRoot();
    writeCommittedBatchFile(rootDir, "bad.json", "{");

    expect(() => store.listCommittedBatches()).toThrow();
  });

  it("listCommittedBatches throws on invalid manifest", () => {
    const { rootDir, store } = createStoreWithRoot();
    writeCommittedBatchFile(
      rootDir,
      "bad.json",
      JSON.stringify({
        schemaVersion: 2,
        kind: "runBatch",
        batchId: "batch-1",
        createdAt: new Date().toISOString(),
        status: "committed",
        actionRunIds: [],
        targetFiles: []
      })
    );

    expect(() => store.listCommittedBatches()).toThrow("Unsupported batch manifest schemaVersion");
  });

  it("listCommittedBatches throws if manifest status is not committed", () => {
    const { rootDir, store } = createStoreWithRoot();
    writeCommittedBatchFile(
      rootDir,
      "bad.json",
      JSON.stringify({
        schemaVersion: 1,
        kind: "runBatch",
        batchId: "batch-1",
        createdAt: new Date().toISOString(),
        status: "pending",
        actionRunIds: [],
        targetFiles: []
      })
    );

    expect(() => store.listCommittedBatches()).toThrow("Unexpected batch status: pending");
  });

  it("clear removes committed markers", () => {
    const { rootDir, store } = createStoreWithRoot();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });

    expect(store.listCommittedBatches()).toHaveLength(1);

    store.clear();

    expect(existsSync(rootDir)).toBe(true);
    expect(store.listCommittedBatches()).toEqual([]);
  });

  it("committed marker uses safe paths for unsafe ids", () => {
    const { rootDir, store } = createStoreWithRoot();
    const unsafeFlowRunId = 'a/b\\c:d*e?f"g<h>i|j';
    const unsafeActionRunId = 'x/y\\z:q*r?s"t<u>v|w';

    store.saveRunBatch({
      flowRun: createFlowRun(unsafeFlowRunId, "running"),
      actionRuns: [createActionRun(unsafeActionRunId, "done")]
    });

    const manifest = readOnlyCommittedBatchManifest(rootDir);

    expect(manifest.status).toBe("committed");
    for (const targetFile of manifest.targetFiles) {
      const segments = targetFile.split("/");

      expect(segments).not.toContain("..");
      for (const segment of segments) {
        expect(segment).not.toMatch(/[\\:*?"<>|]/);
      }
    }
  });

  it("saveRunBatch writes failed marker when staging validation fails", () => {
    const { rootDir, store } = createStoreWithRoot();
    const invalidActionRun = { ...createActionRun("flow-run-1:node-1", "ready"), state: undefined };

    expect(() =>
      store.saveRunBatch({
        flowRun: createFlowRun("flow-run-1", "running"),
        actionRuns: [invalidActionRun]
      })
    ).toThrow("$.state");

    const [batch] = store.listFailedBatches();

    expect(batch.manifest).toMatchObject({
      status: "failed",
      flowRunId: "flow-run-1",
      actionRunIds: ["flow-run-1:node-1"]
    });
    expect(batch.manifest.targetFiles).toEqual([
      `flow-runs/${safeFileName("flow-run-1")}.json`,
      `action-runs/${safeFileName("flow-run-1:node-1")}.json`
    ]);
    expect(readOnlyFailedBatchManifest(rootDir)).toEqual(batch.manifest);
    expect(store.listCommittedBatches()).toEqual([]);
  });

  it("saveRunBatch does not write failed marker on successful batch", () => {
    const store = createStore();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });

    expect(store.listFailedBatches()).toEqual([]);
    expect(store.listCommittedBatches()).toHaveLength(1);
  });

  it("listFailedBatches returns an empty list when failed directory is missing", () => {
    const store = createStore();

    expect(store.listFailedBatches()).toEqual([]);
  });

  it("listFailedBatches returns failed markers in deterministic order", () => {
    const store = createStore();

    expect(() =>
      store.saveRunBatch({
        flowRun: createFlowRun("flow-run-2", "running"),
        actionRuns: [{ ...createActionRun("flow-run-2:node-1", "ready"), state: undefined }]
      })
    ).toThrow("$.state");
    expect(() =>
      store.saveRunBatch({
        flowRun: createFlowRun("flow-run-1", "running"),
        actionRuns: [{ ...createActionRun("flow-run-1:node-1", "ready"), state: undefined }]
      })
    ).toThrow("$.state");

    const batches = store.listFailedBatches();
    const paths = batches.map((batch) => batch.path);

    expect(batches).toHaveLength(2);
    expect(paths).toEqual([...paths].sort());
    expect(batches.map((batch) => batch.manifest.status)).toEqual(["failed", "failed"]);
  });

  it("listFailedBatches throws on corrupted JSON", () => {
    const { rootDir, store } = createStoreWithRoot();
    writeFailedBatchFile(rootDir, "bad.json", "{");

    expect(() => store.listFailedBatches()).toThrow();
  });

  it("listFailedBatches throws on invalid manifest", () => {
    const { rootDir, store } = createStoreWithRoot();
    writeFailedBatchFile(
      rootDir,
      "bad.json",
      JSON.stringify({
        schemaVersion: 2,
        kind: "runBatch",
        batchId: "batch-1",
        createdAt: new Date().toISOString(),
        status: "failed",
        actionRunIds: [],
        targetFiles: []
      })
    );

    expect(() => store.listFailedBatches()).toThrow("Unsupported batch manifest schemaVersion");
  });

  it("listFailedBatches throws if manifest status is not failed", () => {
    const { rootDir, store } = createStoreWithRoot();
    writeFailedBatchFile(
      rootDir,
      "bad.json",
      JSON.stringify({
        schemaVersion: 1,
        kind: "runBatch",
        batchId: "batch-1",
        createdAt: new Date().toISOString(),
        status: "committed",
        actionRunIds: [],
        targetFiles: []
      })
    );

    expect(() => store.listFailedBatches()).toThrow("Unexpected batch status: committed");
  });

  it("clear removes failed markers", () => {
    const { rootDir, store } = createStoreWithRoot();

    expect(() =>
      store.saveRunBatch({
        flowRun: createFlowRun("flow-run-1", "running"),
        actionRuns: [{ ...createActionRun("flow-run-1:node-1", "ready"), state: undefined }]
      })
    ).toThrow("$.state");

    expect(store.listFailedBatches()).toHaveLength(1);

    store.clear();

    expect(existsSync(rootDir)).toBe(true);
    expect(store.listFailedBatches()).toEqual([]);
  });

  it("failed marker uses safe paths for unsafe ids", () => {
    const { rootDir, store } = createStoreWithRoot();
    const unsafeFlowRunId = 'a/b\\c:d*e?f"g<h>i|j';
    const unsafeActionRunId = 'x/y\\z:q*r?s"t<u>v|w';

    expect(() =>
      store.saveRunBatch({
        flowRun: createFlowRun(unsafeFlowRunId, "running"),
        actionRuns: [{ ...createActionRun(unsafeActionRunId, "ready"), state: undefined }]
      })
    ).toThrow("$.state");

    const manifest = readOnlyFailedBatchManifest(rootDir);

    expect(manifest.status).toBe("failed");
    for (const targetFile of manifest.targetFiles) {
      const segments = targetFile.split("/");

      expect(segments).not.toContain("..");
      for (const segment of segments) {
        expect(segment).not.toMatch(/[\\:*?"<>|]/);
      }
    }
  });

  it("checkHealth returns clean for empty store", () => {
    const store = createStore();

    expect(store.checkHealth()).toEqual({
      status: "clean",
      pendingBatches: [],
      committedBatches: [],
      failedBatches: [],
      issues: [],
      summary: {
        pending: 0,
        committed: 0,
        failed: 0
      }
    });
  });

  it("checkHealth reports successful batches as pending plus committed", () => {
    const store = createStore();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });

    const health = store.checkHealth();

    expect(health.status).toBe("has-pending");
    expect(health.summary).toEqual({
      pending: 1,
      committed: 1,
      failed: 0
    });
    expect(health.pendingBatches).toHaveLength(1);
    expect(health.committedBatches).toHaveLength(1);
    expect(health.failedBatches).toEqual([]);
  });

  it("checkHealth reports pending-batch issue", () => {
    const store = createStore();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });

    const health = store.checkHealth();

    expect(health.status).toBe("has-pending");
    expect(health.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "pending-batch",
          batchId: health.pendingBatches[0].manifest.batchId
        })
      ])
    );
  });

  it("checkHealth returns has-pending when pending exists and failed is empty", () => {
    const store = createStore();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });

    expect(store.checkHealth().status).toBe("has-pending");
  });

  it("checkHealth returns has-failed when failed exists and pending is empty", () => {
    const { rootDir, store } = createStoreWithRoot();
    writeFailedBatchFile(
      rootDir,
      "failed.json",
      JSON.stringify({
        schemaVersion: 1,
        kind: "runBatch",
        batchId: "batch-1",
        createdAt: new Date().toISOString(),
        status: "failed",
        actionRunIds: [],
        targetFiles: []
      })
    );

    const health = store.checkHealth();

    expect(health.status).toBe("has-failed");
    expect(health.summary).toEqual({
      pending: 0,
      committed: 0,
      failed: 1
    });
  });

  it("checkHealth returns has-pending-and-failed when both exist", () => {
    const store = createStore();

    expect(() =>
      store.saveRunBatch({
        flowRun: createFlowRun("flow-run-1", "running"),
        actionRuns: [{ ...createActionRun("flow-run-1:node-1", "ready"), state: undefined }]
      })
    ).toThrow("$.state");

    const health = store.checkHealth();

    expect(health.status).toBe("has-pending-and-failed");
    expect(health.summary).toEqual({
      pending: 1,
      committed: 0,
      failed: 1
    });
  });

  it("checkHealth reports failed-batch issue", () => {
    const store = createStore();

    expect(() =>
      store.saveRunBatch({
        flowRun: createFlowRun("flow-run-1", "running"),
        actionRuns: [{ ...createActionRun("flow-run-1:node-1", "ready"), state: undefined }]
      })
    ).toThrow("$.state");

    const health = store.checkHealth();

    expect(health.status).toBe("has-pending-and-failed");
    expect(health.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "failed-batch",
          batchId: health.failedBatches[0].manifest.batchId
        })
      ])
    );
  });

  it("checkHealth includes committed count", () => {
    const store = createStore();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });

    expect(store.checkHealth().summary.committed).toBe(1);
  });

  it("checkHealth reports missing target file for committed batch", () => {
    const store = createStore();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });

    store.deleteActionRun("flow-run-1:node-1");

    const health = store.checkHealth();
    const actionTargetFile = `action-runs/${safeFileName("flow-run-1:node-1")}.json`;

    expect(health.status).toBe("has-pending");
    expect(health.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "missing-target-file",
          targetFile: actionTargetFile
        })
      ])
    );
  });

  it("checkHealth reports all missing target files from committed marker", () => {
    const store = createStore();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done"), createActionRun("flow-run-1:node-2", "done")]
    });

    store.deleteFlowRun("flow-run-1");
    store.deleteActionRun("flow-run-1:node-1");
    store.deleteActionRun("flow-run-1:node-2");

    const issues = store.checkHealth().issues.filter((issue) => issue.kind === "missing-target-file");

    expect(issues).toHaveLength(3);
    expect(issues.map((issue) => issue.targetFile)).toEqual(
      expect.arrayContaining([
        `flow-runs/${safeFileName("flow-run-1")}.json`,
        `action-runs/${safeFileName("flow-run-1:node-1")}.json`,
        `action-runs/${safeFileName("flow-run-1:node-2")}.json`
      ])
    );
  });

  it("checkHealth ignores existing committed target files", () => {
    const store = createStore();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });

    expect(store.checkHealth().issues.some((issue) => issue.kind === "missing-target-file")).toBe(false);
  });

  it("checkHealth propagates invalid pending manifest errors", () => {
    const { rootDir, store } = createStoreWithRoot();
    writePendingBatchFile(rootDir, "bad.json", "{");

    expect(() => store.checkHealth()).toThrow();
  });

  it("checkHealth propagates invalid committed manifest errors", () => {
    const { rootDir, store } = createStoreWithRoot();
    writeCommittedBatchFile(rootDir, "bad.json", "{");

    expect(() => store.checkHealth()).toThrow();
  });

  it("checkHealth propagates invalid failed manifest errors", () => {
    const { rootDir, store } = createStoreWithRoot();
    writeFailedBatchFile(rootDir, "bad.json", "{");

    expect(() => store.checkHealth()).toThrow();
  });

  it("checkHealth does not mutate marker files", () => {
    const { rootDir, store } = createStoreWithRoot();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });
    expect(() =>
      store.saveRunBatch({
        flowRun: createFlowRun("flow-run-2", "running"),
        actionRuns: [{ ...createActionRun("flow-run-2:node-1", "ready"), state: undefined }]
      })
    ).toThrow("$.state");

    store.deleteActionRun("flow-run-1:node-1");

    const before = {
      markers: markerFileCounts(rootDir),
      flowRunExists: store.getFlowRun("flow-run-1") !== undefined,
      actionRunExists: store.getActionRun("flow-run-1:node-1") !== undefined
    };

    store.checkHealth();

    expect({
      markers: markerFileCounts(rootDir),
      flowRunExists: store.getFlowRun("flow-run-1") !== undefined,
      actionRunExists: store.getActionRun("flow-run-1:node-1") !== undefined
    }).toEqual(before);
  });

  it("listPendingBatches returns an empty list when no pending directory exists", () => {
    const store = createStore();

    expect(store.listPendingBatches()).toEqual([]);
  });

  it("listPendingBatches returns pending manifests after saveRunBatch in deterministic order", () => {
    const store = createStore();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-2", "running"),
      actionRuns: [createActionRun("flow-run-2:node-1", "done")]
    });
    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });

    const batches = store.listPendingBatches();
    const paths = batches.map((batch) => batch.path);

    expect(batches).toHaveLength(2);
    expect(paths).toEqual([...paths].sort());
    expect(batches.map((batch) => batch.manifest.status)).toEqual(["pending", "pending"]);
  });

  it("listPendingBatches parses manifest content", () => {
    const store = createStore();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });

    const [batch] = store.listPendingBatches();

    expect(batch.manifest.flowRunId).toBe("flow-run-1");
    expect(batch.manifest.actionRunIds).toEqual(["flow-run-1:node-1"]);
    expect(batch.manifest.targetFiles).toEqual([
      `flow-runs/${safeFileName("flow-run-1")}.json`,
      `action-runs/${safeFileName("flow-run-1:node-1")}.json`
    ]);
  });

  it("listPendingBatches throws on corrupted JSON", () => {
    const { rootDir, store } = createStoreWithRoot();
    writePendingBatchFile(rootDir, "bad.json", "{");

    expect(() => store.listPendingBatches()).toThrow();
  });

  it("listPendingBatches throws on invalid manifest", () => {
    const { rootDir, store } = createStoreWithRoot();
    writePendingBatchFile(
      rootDir,
      "bad.json",
      JSON.stringify({
        schemaVersion: 2,
        kind: "runBatch",
        batchId: "batch-1",
        createdAt: new Date().toISOString(),
        status: "pending",
        actionRunIds: [],
        targetFiles: []
      })
    );

    expect(() => store.listPendingBatches()).toThrow("Unsupported batch manifest schemaVersion");
  });

  it("clear removes pending batches", () => {
    const store = createStore();

    store.saveRunBatch({
      flowRun: createFlowRun("flow-run-1", "running"),
      actionRuns: [createActionRun("flow-run-1:node-1", "done")]
    });

    expect(store.listPendingBatches()).toHaveLength(1);

    store.clear();

    expect(store.listPendingBatches()).toEqual([]);
  });

  function createStore(): FileStateStore {
    return createStoreWithRoot().store;
  }

  function createStoreWithRoot(): { rootDir: string; store: FileStateStore } {
    const rootDir = mkdtempSync(path.join(os.tmpdir(), "actionflow-file-store-"));
    tempDirs.push(rootDir);

    return {
      rootDir,
      store: new FileStateStore({ rootDir })
    };
  }
});

function createActionRun(runId: string, status: ActionRunRecord["status"]): ActionRunRecord {
  return {
    id: runId,
    runId,
    actionId: "echo",
    actionVersion: "1.0.0",
    status
  };
}

function createFlowRun(id: string, status: FlowRunRecord["status"]): FlowRunRecord {
  return {
    id,
    flowId: "flow",
    currentNodeId: "root",
    status
  };
}

function writeManagedFile(rootDir: string, subdir: string, id: string, content: string): void {
  const dir = path.join(rootDir, subdir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${safeFileName(id)}.json`), content, "utf8");
}

function writePendingBatchFile(rootDir: string, fileName: string, content: string): void {
  const dir = path.join(rootDir, "batches", "pending");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, fileName), content, "utf8");
}

function writeCommittedBatchFile(rootDir: string, fileName: string, content: string): void {
  const dir = path.join(rootDir, "batches", "committed");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, fileName), content, "utf8");
}

function writeFailedBatchFile(rootDir: string, fileName: string, content: string): void {
  const dir = path.join(rootDir, "batches", "failed");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, fileName), content, "utf8");
}

function listPendingBatchManifestFiles(rootDir: string): string[] {
  const dir = path.join(rootDir, "batches", "pending");

  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => path.join(dir, fileName));
}

function readOnlyPendingBatchManifest(rootDir: string): FileStoreBatchManifest {
  const files = listPendingBatchManifestFiles(rootDir);

  expect(files).toHaveLength(1);

  return parseBatchManifest(JSON.parse(readFileSync(files[0], "utf8")) as unknown);
}

function readOnlyCommittedBatchManifest(rootDir: string): FileStoreBatchManifest {
  const files = listCommittedBatchManifestFiles(rootDir);

  expect(files).toHaveLength(1);

  return parseBatchManifest(JSON.parse(readFileSync(files[0], "utf8")) as unknown);
}

function readOnlyFailedBatchManifest(rootDir: string): FileStoreBatchManifest {
  const files = listFailedBatchManifestFiles(rootDir);

  expect(files).toHaveLength(1);

  return parseBatchManifest(JSON.parse(readFileSync(files[0], "utf8")) as unknown);
}

function listCommittedBatchManifestFiles(rootDir: string): string[] {
  const dir = path.join(rootDir, "batches", "committed");

  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => path.join(dir, fileName));
}

function listFailedBatchManifestFiles(rootDir: string): string[] {
  const dir = path.join(rootDir, "batches", "failed");

  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => path.join(dir, fileName));
}

function markerFileCounts(rootDir: string): { pending: number; committed: number; failed: number } {
  return {
    pending: listPendingBatchManifestFiles(rootDir).length,
    committed: listCommittedBatchManifestFiles(rootDir).length,
    failed: listFailedBatchManifestFiles(rootDir).length
  };
}

function pendingBatchRecordsDir(rootDir: string, manifest: FileStoreBatchManifest): string {
  return path.join(rootDir, "batches", "pending", `${safeFileName(manifest.batchId)}-records`);
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

function listStagingRecordFiles(recordsDir: string): string[] {
  if (!existsSync(recordsDir)) {
    return [];
  }

  return ["flow-runs", "action-runs"].flatMap((subdir) => {
    const dir = path.join(recordsDir, subdir);

    if (!existsSync(dir)) {
      return [];
    }

    return readdirSync(dir)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => path.join(dir, fileName));
  });
}
