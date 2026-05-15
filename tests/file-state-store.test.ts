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
