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

import type {
  BatchStateStore,
  StateStoreRunBatch,
  WaitingIndexStore,
  WaitingRunFilter,
  WaitingRunIndexEntry
} from "./state-store.js";
import type { ActionRunRecord, FlowRunRecord } from "./types.js";
import {
  createBatchManifest,
  createBatchTargetFiles,
  parseBatchManifest,
  type FileStoreBatchManifest
} from "./file-state-store-batch.js";
import { assertJsonSerializable, createEnvelope, parseEnvelope, safeFileName } from "./file-state-store-utils.js";

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

export type FileStateStoreHealthIssueKind = "missing-target-file" | "failed-batch" | "pending-batch";

export interface FileStateStoreHealthIssue {
  kind: FileStateStoreHealthIssueKind;
  batchId: string;
  targetFile?: string;
  message: string;
}

export interface FileStateStoreHealth {
  status: FileStateStoreBatchHealthStatus;
  pendingBatches: readonly FileStateStorePendingBatch[];
  committedBatches: readonly FileStateStoreCommittedBatch[];
  failedBatches: readonly FileStateStoreFailedBatch[];
  issues: readonly FileStateStoreHealthIssue[];
  summary: {
    pending: number;
    committed: number;
    failed: number;
  };
}

export class FileStateStore implements BatchStateStore, WaitingIndexStore {
  private readonly rootDir: string;
  private readonly actionRunsDir: string;
  private readonly flowRunsDir: string;
  private readonly waitingRunsDir: string;
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
    this.waitingRunsDir = path.join(this.rootDir, "waiting-runs");
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
    const issues = this.collectHealthIssues(pendingBatches, committedBatches, failedBatches);

    return {
      status: batchHealthStatus(pending, failed),
      pendingBatches,
      committedBatches,
      failedBatches,
      issues,
      summary: {
        pending,
        committed: committedBatches.length,
        failed
      }
      };
  }

  indexWaitingActionRun(run: ActionRunRecord): void {
    if (run.status !== "waiting") {
      throw new Error("ActionRun is not waiting");
    }

    if (typeof run.waitReason !== "string" || run.waitReason.length === 0) {
      throw new Error("waitReason is required");
    }

    const runId = actionRunKey(run);
    const entry: WaitingRunIndexEntry = {
      runId,
      actionId: run.actionId,
      waitReason: run.waitReason,
      status: "waiting",
      indexedAt: new Date().toISOString()
    };

    if (run.actionVersion !== undefined) {
      entry.actionVersion = run.actionVersion;
    }

    const prefix = parseFlowRunPrefix(runId);
    if (prefix) {
      entry.flowRunId = prefix.flowRunId;
      entry.nodeId = prefix.nodeId;
    }

    assertJsonSerializable(entry);
    this.writeJsonFile(this.waitingRunPath(runId), entry);
  }

  removeWaitingActionRun(runId: string): void {
    const filePath = this.waitingRunPath(runId);

    if (!existsSync(filePath)) {
      return;
    }

    unlinkSync(filePath);
  }

  listWaitingActionRuns(filter: WaitingRunFilter = {}): readonly WaitingRunIndexEntry[] {
    this.assertManagedDirectory(this.waitingRunsDir);

    if (!existsSync(this.waitingRunsDir)) {
      return [];
    }

    return readdirSync(this.waitingRunsDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => parseWaitingRunIndexEntry(JSON.parse(readFileSync(path.join(this.waitingRunsDir, fileName), "utf8"))))
      .filter((entry) => matchesWaitingFilter(entry, filter))
      .sort((left, right) => left.runId.localeCompare(right.runId));
  }

  private collectHealthIssues(
    pendingBatches: readonly FileStateStorePendingBatch[],
    committedBatches: readonly FileStateStoreCommittedBatch[],
    failedBatches: readonly FileStateStoreFailedBatch[]
  ): FileStateStoreHealthIssue[] {
    const issues: FileStateStoreHealthIssue[] = [];

    for (const batch of pendingBatches) {
      issues.push({
        kind: "pending-batch",
        batchId: batch.manifest.batchId,
        message: `Pending batch: ${batch.manifest.batchId}`
      });
    }

    for (const batch of failedBatches) {
      issues.push({
        kind: "failed-batch",
        batchId: batch.manifest.batchId,
        message: `Failed batch: ${batch.manifest.batchId}`
      });
    }

    for (const batch of committedBatches) {
      for (const targetFile of batch.manifest.targetFiles) {
        const targetPath = this.batchTargetPath(targetFile);

        if (!existsSync(targetPath)) {
          issues.push({
            kind: "missing-target-file",
            batchId: batch.manifest.batchId,
            targetFile,
            message: `Missing target file for batch ${batch.manifest.batchId}: ${targetFile}`
          });
        }
      }
    }

    return issues;
  }

  private batchTargetPath(targetFile: string): string {
    const targetPath = path.resolve(this.rootDir, ...targetFile.split(/[\\/]/));
    this.assertManagedDirectory(targetPath);
    return targetPath;
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
    this.clearManagedDirectory(this.waitingRunsDir);
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

  private waitingRunPath(runId: string): string {
    return this.recordPath(this.waitingRunsDir, runId);
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

function parseWaitingRunIndexEntry(raw: unknown): WaitingRunIndexEntry {
  if (!isPlainObject(raw)) {
    throw new Error("Invalid waiting run index entry");
  }

  assertJsonSerializable(raw);

  if (!isNonEmptyString(raw.runId)) {
    throw new Error("Invalid waiting runId");
  }

  if (!isNonEmptyString(raw.actionId)) {
    throw new Error("Invalid waiting actionId");
  }

  if (raw.actionVersion !== undefined && typeof raw.actionVersion !== "string") {
    throw new Error("Invalid waiting actionVersion");
  }

  if (!isNonEmptyString(raw.waitReason)) {
    throw new Error("Invalid waitReason");
  }

  if (raw.status !== "waiting") {
    throw new Error("Invalid waiting status");
  }

  if (!isNonEmptyString(raw.indexedAt)) {
    throw new Error("Invalid indexedAt");
  }

  if (raw.flowRunId !== undefined && typeof raw.flowRunId !== "string") {
    throw new Error("Invalid flowRunId");
  }

  if (raw.nodeId !== undefined && typeof raw.nodeId !== "string") {
    throw new Error("Invalid nodeId");
  }

  return raw as unknown as WaitingRunIndexEntry;
}

function parseFlowRunPrefix(runId: string): { flowRunId: string; nodeId: string } | undefined {
  const separatorIndex = runId.indexOf(":");

  if (separatorIndex < 0) {
    return undefined;
  }

  return {
    flowRunId: runId.slice(0, separatorIndex),
    nodeId: runId.slice(separatorIndex + 1)
  };
}

function matchesWaitingFilter(entry: WaitingRunIndexEntry, filter: WaitingRunFilter): boolean {
  if (filter.waitReason !== undefined && entry.waitReason !== filter.waitReason) {
    return false;
  }

  if (filter.flowRunId !== undefined && entry.flowRunId !== filter.flowRunId) {
    return false;
  }

  if (filter.actionId !== undefined && entry.actionId !== filter.actionId) {
    return false;
  }

  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
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
