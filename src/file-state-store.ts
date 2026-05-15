import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import type { BatchStateStore, StateStoreRunBatch } from "./state-store.js";
import type { ActionRunRecord, FlowRunRecord } from "./types.js";
import {
  createBatchManifest,
  createBatchTargetFiles,
  parseBatchManifest,
  type FileStoreBatchManifest
} from "./file-state-store-batch.js";
import { createEnvelope, parseEnvelope, safeFileName } from "./file-state-store-utils.js";

export interface FileStateStoreOptions {
  rootDir: string;
}

export interface FileStateStorePendingBatch {
  path: string;
  manifest: FileStoreBatchManifest;
}

export interface FileStateStoreCommittedBatch {
  path: string;
  manifest: FileStoreBatchManifest;
}

export interface FileStateStoreFailedBatch {
  path: string;
  manifest: FileStoreBatchManifest;
}

export type FileStateStoreBatchHealthStatus = "clean" | "has-pending" | "has-failed" | "has-pending-and-failed";

export interface FileStateStoreHealth {
  status: FileStateStoreBatchHealthStatus;
  pendingBatches: readonly FileStateStorePendingBatch[];
  committedBatches: readonly FileStateStoreCommittedBatch[];
  failedBatches: readonly FileStateStoreFailedBatch[];
  summary: {
    pending: number;
    committed: number;
    failed: number;
  };
}

export class FileStateStore implements BatchStateStore {
  private readonly rootDir: string;
  private readonly actionRunsDir: string;
  private readonly flowRunsDir: string;
  private readonly batchesDir: string;
  private readonly pendingBatchesDir: string;
  private readonly committedBatchesDir: string;
  private readonly failedBatchesDir: string;

  constructor(options: FileStateStoreOptions) {
    if (typeof options.rootDir !== "string" || options.rootDir.length === 0) {
      throw new Error("rootDir must be a non-empty string");
    }

    this.rootDir = path.resolve(options.rootDir);
    this.actionRunsDir = path.join(this.rootDir, "action-runs");
    this.flowRunsDir = path.join(this.rootDir, "flow-runs");
    this.batchesDir = path.join(this.rootDir, "batches");
    this.pendingBatchesDir = path.join(this.batchesDir, "pending");
    this.committedBatchesDir = path.join(this.batchesDir, "committed");
    this.failedBatchesDir = path.join(this.batchesDir, "failed");
  }

  saveActionRun(run: ActionRunRecord): void {
    const runId = actionRunKey(run);
    this.writeRecord(this.actionRunsDir, runId, "actionRun", run);
  }

  getActionRun(runId: string): ActionRunRecord | undefined {
    return this.readRecord(this.actionRunsDir, runId, "actionRun");
  }

  listActionRuns(): readonly ActionRunRecord[] {
    return this.listRecords(this.actionRunsDir, "actionRun");
  }

  saveFlowRun(run: FlowRunRecord): void {
    this.writeRecord(this.flowRunsDir, run.id, "flowRun", run);
  }

  saveRunBatch(batch: StateStoreRunBatch): void {
    const manifest = this.writePendingBatchManifest(batch);

    try {
      this.writeAndValidateStagingRecords(batch, manifest);

      if (batch.flowRun) {
        this.saveFlowRun(batch.flowRun);
      }

      for (const actionRun of batch.actionRuns ?? []) {
        this.saveActionRun(actionRun);
      }

      this.writeCommittedBatchMarker(manifest);
    } catch (error) {
      try {
        this.writeFailedBatchMarker(manifest);
      } catch {
        // Preserve the original batch failure. Failed markers are best-effort diagnostics.
      }

      throw error;
    }
  }

  getFlowRun(flowRunId: string): FlowRunRecord | undefined {
    return this.readRecord(this.flowRunsDir, flowRunId, "flowRun");
  }

  listFlowRuns(): readonly FlowRunRecord[] {
    return this.listRecords(this.flowRunsDir, "flowRun");
  }

  listPendingBatches(): readonly FileStateStorePendingBatch[] {
    return this.listBatchManifests(this.pendingBatchesDir, "pending");
  }

  listCommittedBatches(): readonly FileStateStoreCommittedBatch[] {
    return this.listBatchManifests(this.committedBatchesDir, "committed");
  }

  listFailedBatches(): readonly FileStateStoreFailedBatch[] {
    return this.listBatchManifests(this.failedBatchesDir, "failed");
  }

  checkHealth(): FileStateStoreHealth {
    const pendingBatches = this.listPendingBatches();
    const committedBatches = this.listCommittedBatches();
    const failedBatches = this.listFailedBatches();
    const pending = pendingBatches.length;
    const failed = failedBatches.length;

    return {
      status: batchHealthStatus(pending, failed),
      pendingBatches,
      committedBatches,
      failedBatches,
      summary: {
        pending,
        committed: committedBatches.length,
        failed
      }
    };
  }

  deleteActionRun(runId: string): boolean {
    return this.deleteRecord(this.actionRunsDir, runId);
  }

  deleteFlowRun(flowRunId: string): boolean {
    return this.deleteRecord(this.flowRunsDir, flowRunId);
  }

  clear(): void {
    this.clearManagedDirectory(this.actionRunsDir);
    this.clearManagedDirectory(this.flowRunsDir);
    this.clearManagedDirectory(this.batchesDir);
  }

  private ensureManagedDirectory(dir: string): void {
    this.assertManagedDirectory(dir);
    mkdirSync(dir, { recursive: true });
  }

  private recordPath(dir: string, id: string): string {
    this.assertManagedDirectory(dir);
    return path.join(dir, `${safeFileName(id)}.json`);
  }

  private writeRecord<T>(dir: string, id: string, kind: "actionRun" | "flowRun", data: T): void {
    this.ensureManagedDirectory(dir);

    const targetPath = this.recordPath(dir, id);
    const envelope = createEnvelope(kind, data);

    this.writeJsonFile(targetPath, envelope);
  }

  private writePendingBatchManifest(batch: StateStoreRunBatch): FileStoreBatchManifest {
    const actionRunIds = (batch.actionRuns ?? []).map(actionRunKey);
    const manifest = createBatchManifest({
      status: "pending",
      flowRunId: batch.flowRun?.id,
      actionRunIds,
      targetFiles: createBatchTargetFiles({
        flowRunId: batch.flowRun?.id,
        actionRunIds
      })
    });
    const targetPath = path.join(this.pendingBatchesDir, `${safeFileName(manifest.batchId)}.json`);

    this.ensureManagedDirectory(this.pendingBatchesDir);
    this.writeJsonFile(targetPath, manifest);

    return manifest;
  }

  private writeCommittedBatchMarker(pendingManifest: FileStoreBatchManifest): void {
    const manifest = createBatchManifest({
      batchId: pendingManifest.batchId,
      status: "committed",
      flowRunId: pendingManifest.flowRunId,
      actionRunIds: pendingManifest.actionRunIds,
      targetFiles: pendingManifest.targetFiles
    });
    const targetPath = path.join(this.committedBatchesDir, `${safeFileName(manifest.batchId)}.json`);

    this.ensureManagedDirectory(this.committedBatchesDir);
    this.writeJsonFile(targetPath, manifest);
  }

  private writeFailedBatchMarker(pendingManifest: FileStoreBatchManifest): void {
    const manifest = createBatchManifest({
      batchId: pendingManifest.batchId,
      status: "failed",
      flowRunId: pendingManifest.flowRunId,
      actionRunIds: pendingManifest.actionRunIds,
      targetFiles: pendingManifest.targetFiles
    });
    const targetPath = path.join(this.failedBatchesDir, `${safeFileName(manifest.batchId)}.json`);

    this.ensureManagedDirectory(this.failedBatchesDir);
    this.writeJsonFile(targetPath, manifest);
  }

  private writeAndValidateStagingRecords(batch: StateStoreRunBatch, manifest: FileStoreBatchManifest): void {
    const recordsDir = this.pendingBatchRecordsDir(manifest.batchId);
    const stagedRecords: Array<{ path: string; kind: "actionRun" | "flowRun" }> = [];

    if (batch.flowRun) {
      const flowRunsDir = path.join(recordsDir, "flow-runs");
      this.writeRecord(flowRunsDir, batch.flowRun.id, "flowRun", batch.flowRun);
      stagedRecords.push({
        path: this.recordPath(flowRunsDir, batch.flowRun.id),
        kind: "flowRun"
      });
    }

    for (const actionRun of batch.actionRuns ?? []) {
      const actionRunsDir = path.join(recordsDir, "action-runs");
      const actionRunId = actionRunKey(actionRun);
      this.writeRecord(actionRunsDir, actionRunId, "actionRun", actionRun);
      stagedRecords.push({
        path: this.recordPath(actionRunsDir, actionRunId),
        kind: "actionRun"
      });
    }

    for (const stagedRecord of stagedRecords) {
      this.readRecordFile(stagedRecord.path, stagedRecord.kind);
    }
  }

  private pendingBatchRecordsDir(batchId: string): string {
    return path.join(this.pendingBatchesDir, `${safeFileName(batchId)}-records`);
  }

  private writeJsonFile(targetPath: string, data: unknown): void {
    const dir = path.dirname(targetPath);

    this.ensureManagedDirectory(dir);

    const tempPath = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
    const content = `${JSON.stringify(data, null, 2)}\n`;

    try {
      writeFileSync(tempPath, content, "utf8");

      if (existsSync(targetPath)) {
        // MVP single-process overwrite strategy for Windows rename behavior.
        unlinkSync(targetPath);
      }

      renameSync(tempPath, targetPath);
    } catch (error) {
      if (existsSync(tempPath)) {
        rmSync(tempPath, { force: true });
      }

      throw error;
    }
  }

  private readRecord<T>(dir: string, id: string, kind: "actionRun" | "flowRun"): T | undefined {
    const filePath = this.recordPath(dir, id);

    if (!existsSync(filePath)) {
      return undefined;
    }

    return this.readRecordFile(filePath, kind);
  }

  private listRecords<T>(dir: string, kind: "actionRun" | "flowRun"): T[] {
    this.assertManagedDirectory(dir);

    if (!existsSync(dir)) {
      return [];
    }

    return readdirSync(dir)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => this.readRecordFile(path.join(dir, fileName), kind));
  }

  private readRecordFile<T>(filePath: string, kind: "actionRun" | "flowRun"): T {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return parseEnvelope<T>(raw, kind).data;
  }

  private listBatchManifests(
    dir: string,
    expectedStatus: "pending" | "committed" | "failed"
  ): Array<{ path: string; manifest: FileStoreBatchManifest }> {
    this.assertManagedDirectory(dir);

    if (!existsSync(dir)) {
      return [];
    }

    return readdirSync(dir)
      .filter((fileName) => fileName.endsWith(".json"))
      .sort()
      .map((fileName) => {
        const filePath = path.join(dir, fileName);
        const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
        const manifest = parseBatchManifest(raw);

        if (manifest.status !== expectedStatus) {
          throw new Error(`Unexpected batch status: ${manifest.status}`);
        }

        return {
          path: filePath,
          manifest
        };
      });
  }

  private deleteRecord(dir: string, id: string): boolean {
    const filePath = this.recordPath(dir, id);

    if (!existsSync(filePath)) {
      return false;
    }

    unlinkSync(filePath);
    return true;
  }

  private clearManagedDirectory(dir: string): void {
    this.assertManagedDirectory(dir);

    if (!existsSync(dir)) {
      return;
    }

    rmSync(dir, { recursive: true, force: true });
  }

  private assertManagedDirectory(dir: string): void {
    const resolvedDir = path.resolve(dir);
    const relative = path.relative(this.rootDir, resolvedDir);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("FileStateStore path escapes rootDir");
    }
  }
}

function actionRunKey(run: ActionRunRecord): string {
  return run.runId ?? run.id;
}

function batchHealthStatus(pending: number, failed: number): FileStateStoreBatchHealthStatus {
  if (pending > 0 && failed > 0) {
    return "has-pending-and-failed";
  }

  if (pending > 0) {
    return "has-pending";
  }

  if (failed > 0) {
    return "has-failed";
  }

  return "clean";
}
