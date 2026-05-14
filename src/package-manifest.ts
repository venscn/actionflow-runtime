export interface ActionFlowPackageManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  actions?: PackageActionRef[];
  flows?: PackageFlowRef[];
  rules?: PackageRuleRef[];
  configSchema?: unknown;
  permissions?: string[];
}

export interface PackageActionRef {
  id: string;
  version?: string;
}

export interface PackageFlowRef {
  id: string;
  version?: string;
}

export interface PackageRuleRef {
  id: string;
  event: string;
  flow: string;
  enabled?: boolean;
}

export type PackageManifestValidationResult =
  | {
      valid: true;
      manifest: ActionFlowPackageManifest;
    }
  | {
      valid: false;
      errors: string[];
    };

export type PackageManifestRegistryCheckResult =
  | {
      valid: true;
    }
  | {
      valid: false;
      errors: string[];
    };

export interface PackageManifestRegistryCheckParams {
  manifest: ActionFlowPackageManifest;
  actions?: RegistryLookup;
  flows?: RegistryLookup;
}

export function validatePackageManifest(manifest: unknown): PackageManifestValidationResult {
  const errors: string[] = [];

  if (!isRecord(manifest)) {
    return {
      valid: false,
      errors: ["manifest must be an object"]
    };
  }

  requireNonEmptyString(manifest, "id", errors);
  requireNonEmptyString(manifest, "name", errors);
  requireNonEmptyString(manifest, "version", errors);

  validateActions(manifest, errors);
  validateFlows(manifest, errors);
  validateRules(manifest, errors);
  validatePermissions(manifest, errors);

  if (errors.length > 0) {
    return {
      valid: false,
      errors
    };
  }

  return {
    valid: true,
    manifest: manifest as unknown as ActionFlowPackageManifest
  };
}

export function checkPackageManifestRegistries(
  params: PackageManifestRegistryCheckParams
): PackageManifestRegistryCheckResult {
  const errors: string[] = [];

  if (params.actions && params.manifest.actions) {
    for (const action of params.manifest.actions) {
      if (!params.actions.has(action.id, action.version)) {
        errors.push(`Missing action: ${formatRef(action)}`);
      }
    }
  }

  if (params.flows && params.manifest.flows) {
    for (const flow of params.manifest.flows) {
      if (!params.flows.has(flow.id, flow.version)) {
        errors.push(`Missing flow: ${formatRef(flow)}`);
      }
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors
    };
  }

  return {
    valid: true
  };
}

interface RegistryLookup {
  has(id: string, version?: string): boolean;
}

function formatRef(ref: { id: string; version?: string }): string {
  return ref.version ? `${ref.id}@${ref.version}` : ref.id;
}

function validateActions(manifest: Record<string, unknown>, errors: string[]): void {
  if (manifest.actions === undefined) {
    return;
  }

  if (!Array.isArray(manifest.actions)) {
    errors.push("actions must be an array");
    return;
  }

  manifest.actions.forEach((action, index) => {
    if (!isRecord(action)) {
      errors.push(`actions[${index}] must be an object`);
      return;
    }

    requireNonEmptyString(action, "id", errors, `actions[${index}].id`);
  });
}

function validateFlows(manifest: Record<string, unknown>, errors: string[]): void {
  if (manifest.flows === undefined) {
    return;
  }

  if (!Array.isArray(manifest.flows)) {
    errors.push("flows must be an array");
    return;
  }

  manifest.flows.forEach((flow, index) => {
    if (!isRecord(flow)) {
      errors.push(`flows[${index}] must be an object`);
      return;
    }

    requireNonEmptyString(flow, "id", errors, `flows[${index}].id`);
  });
}

function validateRules(manifest: Record<string, unknown>, errors: string[]): void {
  if (manifest.rules === undefined) {
    return;
  }

  if (!Array.isArray(manifest.rules)) {
    errors.push("rules must be an array");
    return;
  }

  manifest.rules.forEach((rule, index) => {
    if (!isRecord(rule)) {
      errors.push(`rules[${index}] must be an object`);
      return;
    }

    requireNonEmptyString(rule, "id", errors, `rules[${index}].id`);
    requireNonEmptyString(rule, "event", errors, `rules[${index}].event`);
    requireNonEmptyString(rule, "flow", errors, `rules[${index}].flow`);

    if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") {
      errors.push(`rules[${index}].enabled must be a boolean`);
    }
  });
}

function validatePermissions(manifest: Record<string, unknown>, errors: string[]): void {
  if (manifest.permissions === undefined) {
    return;
  }

  if (!Array.isArray(manifest.permissions)) {
    errors.push("permissions must be an array");
    return;
  }

  manifest.permissions.forEach((permission, index) => {
    if (typeof permission !== "string") {
      errors.push(`permissions[${index}] must be a string`);
    }
  });
}

function requireNonEmptyString(
  target: Record<string, unknown>,
  field: string,
  errors: string[],
  label = field
): void {
  if (typeof target[field] !== "string" || target[field].trim().length === 0) {
    errors.push(`${label} must be a non-empty string`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
