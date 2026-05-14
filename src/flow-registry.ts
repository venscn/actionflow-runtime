import type { FlowDefinition } from "./types.js";

export class FlowRegistry {
  private readonly flows = new Map<string, Map<string, FlowDefinition>>();

  register(flow: FlowDefinition): void {
    validateFlow(flow);

    const versions = this.flows.get(flow.id) ?? new Map<string, FlowDefinition>();

    if (versions.has(flow.version)) {
      throw new Error(`Flow already registered: ${flow.id}@${flow.version}`);
    }

    versions.set(flow.version, flow);
    this.flows.set(flow.id, versions);
  }

  get(id: string, version?: string): FlowDefinition | undefined {
    const versions = this.flows.get(id);

    if (!versions) {
      return undefined;
    }

    if (version !== undefined) {
      return versions.get(version);
    }

    return [...versions.values()].sort((left, right) => compareVersions(right.version, left.version))[0];
  }

  has(id: string, version?: string): boolean {
    return this.get(id, version) !== undefined;
  }

  list(): readonly FlowDefinition[] {
    return [...this.flows.values()].flatMap((versions) => [...versions.values()]);
  }

  delete(id: string, version?: string): boolean {
    if (version === undefined) {
      return this.flows.delete(id);
    }

    const versions = this.flows.get(id);

    if (!versions) {
      return false;
    }

    const deleted = versions.delete(version);

    if (versions.size === 0) {
      this.flows.delete(id);
    }

    return deleted;
  }

  clear(): void {
    this.flows.clear();
  }
}

function validateFlow(flow: FlowDefinition): void {
  if (typeof flow.id !== "string" || flow.id.trim().length === 0) {
    throw new Error("Flow id must be a non-empty string");
  }

  if (typeof flow.version !== "string" || flow.version.trim().length === 0) {
    throw new Error("Flow version must be a non-empty string");
  }

  if (flow.root === undefined || flow.root === null) {
    throw new Error("Flow root is required");
  }
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? "0";
    const rightPart = rightParts[index] ?? "0";
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);

    if (Number.isInteger(leftNumber) && Number.isInteger(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }

    if (leftPart !== rightPart) {
      return leftPart.localeCompare(rightPart);
    }
  }

  return 0;
}
