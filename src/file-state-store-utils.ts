export type FileStoreRecordKind = "actionRun" | "flowRun";

export interface FileStoreEnvelope<T> {
  schemaVersion: 1;
  kind: FileStoreRecordKind;
  savedAt: string;
  data: T;
}

export function safeFileName(id: string): string {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("id must be a non-empty string");
  }

  const encoded = Buffer.from(id, "utf8").toString("base64url");

  if (encoded.length === 0) {
    throw new Error("safe file name must not be empty");
  }

  return encoded;
}

export function assertJsonSerializable(value: unknown): void {
  assertJsonValue(value, "$", new WeakSet<object>());
}

export function createEnvelope<T>(kind: FileStoreRecordKind, data: T): FileStoreEnvelope<T> {
  assertRecordKind(kind);
  assertJsonSerializable(data);

  return {
    schemaVersion: 1,
    kind,
    savedAt: new Date().toISOString(),
    data
  };
}

export function parseEnvelope<T>(raw: unknown, expectedKind: FileStoreRecordKind): FileStoreEnvelope<T> {
  assertRecordKind(expectedKind);

  if (!isPlainObject(raw)) {
    throw new Error("Invalid file store envelope");
  }

  if (raw.schemaVersion !== 1) {
    throw new Error("Unsupported schemaVersion");
  }

  if (raw.kind !== expectedKind) {
    throw new Error("Unexpected record kind");
  }

  if (typeof raw.savedAt !== "string") {
    throw new Error("Invalid savedAt");
  }

  if (!Object.prototype.hasOwnProperty.call(raw, "data")) {
    throw new Error("Missing data");
  }

  assertJsonSerializable(raw.data);

  return raw as unknown as FileStoreEnvelope<T>;
}

function assertJsonValue(value: unknown, path: string, seen: WeakSet<object>): void {
  if (value === null) {
    return;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} must be a finite number`);
    }

    return;
  }

  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw new Error(`${path} is not JSON-serializable`);
  }

  if (typeof value !== "object") {
    throw new Error(`${path} is not JSON-serializable`);
  }

  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new Error(`${path} must be a plain JSON object or array`);
  }

  if (seen.has(value)) {
    throw new Error(`${path} contains a circular reference`);
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertJsonValue(item, `${path}[${index}]`, seen);
    });
  } else {
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${path}.${key}`, seen);
    }
  }

  seen.delete(value);
}

function assertRecordKind(kind: FileStoreRecordKind): void {
  if (kind !== "actionRun" && kind !== "flowRun") {
    throw new Error("Invalid file store record kind");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
