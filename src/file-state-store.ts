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

import type { StateStore } from "./state-store.js";
import type { ActionRunRecord, FlowRunRecord } from "./types.js";
import { createEnvelope, parseEnvelope, safeFileName } from "./file-state-store-utils.js";

export interface FileStateStoreOptions {
  rootDir: string;
}

export class FileStateStore implements StateStore {
  private readonly rootDir: string;
  private readonly actionRunsDir: string;
  private readonly flowRunsDir: string;

  constructor(options: FileStateStoreOptions) {
    if (typeof options.rootDir !== "string" || options.rootDir.length === 0) {
      throw new Error("rootDir must be a non-empty string");
    }

    this.rootDir = path.resolve(options.rootDir);
    this.actionRunsDir = path.join(this.rootDir, "action-runs");
    this.flowRunsDir = path.join(this.rootDir, "flow-runs");
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

  getFlowRun(flowRunId: string): FlowRunRecord | undefined {
    return this.readRecord(this.flowRunsDir, flowRunId, "flowRun");
  }

  listFlowRuns(): readonly FlowRunRecord[] {
    return this.listRecords(this.flowRunsDir, "flowRun");
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
    const tempPath = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
    const envelope = createEnvelope(kind, data);
    const content = `${JSON.stringify(envelope, null, 2)}\n`;

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
