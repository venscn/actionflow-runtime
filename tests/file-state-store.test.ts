import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { ActionFlowRuntime, createEnvelope, FileStateStore, safeFileName, supportsRunBatch } from "../src/index.js";
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
