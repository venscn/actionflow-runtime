import { randomUUID } from "node:crypto";
import path from "node:path";

import { assertJsonSerializable, safeFileName } from "./file-state-store-utils.js";

export type FileStoreBatchStatus = "pending" | "committed" | "failed";

export interface FileStoreBatchManifest {
  schemaVersion: 1;
  kind: "runBatch";
  batchId: string;
  createdAt: string;
  status: FileStoreBatchStatus;
  flowRunId?: string;
  actionRunIds: string[];
  targetFiles: string[];
}

export function createFileStoreBatchId(now: Date = new Date()): string {
  assertValidDate(now);

  const timestamp = now.toISOString().replace(/[\/\\:*?"<>|]/g, "-");
  return `${timestamp}-${randomUUID()}`;
}

export function createBatchManifest(params: {
  batchId?: string;
  status?: FileStoreBatchStatus;
  flowRunId?: string;
  actionRunIds?: string[];
  targetFiles?: string[];
  now?: Date;
} = {}): FileStoreBatchManifest {
  const now = params.now ?? new Date();
  assertValidDate(now);

  const manifest: FileStoreBatchManifest = {
    schemaVersion: 1,
    kind: "runBatch",
    batchId: params.batchId ?? createFileStoreBatchId(now),
    createdAt: now.toISOString(),
    status: params.status ?? "pending",
    actionRunIds: params.actionRunIds ?? [],
    targetFiles: params.targetFiles ?? []
  };

  if (params.flowRunId !== undefined) {
    manifest.flowRunId = params.flowRunId;
  }

  validateBatchManifestShape(manifest as unknown as Record<string, unknown>);
  assertJsonSerializable(manifest);

  return manifest;
}

export function parseBatchManifest(raw: unknown): FileStoreBatchManifest {
  if (!isPlainObject(raw)) {
    throw new Error("Invalid file store batch manifest");
  }

  if (raw.schemaVersion !== 1) {
    throw new Error("Unsupported batch manifest schemaVersion");
  }

  if (raw.kind !== "runBatch") {
    throw new Error("Unexpected batch manifest kind");
  }

  validateBatchManifestShape(raw);
  assertJsonSerializable(raw);

  return raw as unknown as FileStoreBatchManifest;
}

export function createBatchTargetFiles(params: { flowRunId?: string; actionRunIds?: string[] }): string[] {
  const targets: string[] = [];

  if (params.flowRunId !== undefined) {
    targets.push(`flow-runs/${safeFileName(params.flowRunId)}.json`);
  }

  for (const actionRunId of params.actionRunIds ?? []) {
    targets.push(`action-runs/${safeFileName(actionRunId)}.json`);
  }

  return targets;
}

function validateBatchManifestShape(value: Record<string, unknown>): void {
  if (!isNonEmptyString(value.batchId)) {
    throw new Error("Invalid batchId");
  }

  if (typeof value.createdAt !== "string") {
    throw new Error("Invalid createdAt");
  }

  if (!isBatchStatus(value.status)) {
    throw new Error("Invalid batch status");
  }

  if (value.flowRunId !== undefined && !isNonEmptyString(value.flowRunId)) {
    throw new Error("Invalid flowRunId");
  }

  if (!Array.isArray(value.actionRunIds) || !value.actionRunIds.every(isNonEmptyString)) {
    throw new Error("Invalid actionRunIds");
  }

  if (!Array.isArray(value.targetFiles) || !value.targetFiles.every(isSafeRelativeTargetFile)) {
    throw new Error("Invalid targetFiles");
  }
}

function isBatchStatus(value: unknown): value is FileStoreBatchStatus {
  return value === "pending" || value === "committed" || value === "failed";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSafeRelativeTargetFile(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }

  if (path.isAbsolute(value)) {
    return false;
  }

  return !value.split(/[\\/]/).includes("..");
}

function assertValidDate(value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Invalid Date");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
