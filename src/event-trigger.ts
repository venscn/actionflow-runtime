export interface EventTriggerDefinition {
  id: string;
  event: string;
  flow: string;
  enabled?: boolean;
  description?: string;
  filter?: unknown;
  input?: unknown;
}

export type EventTriggerValidationResult =
  | {
      valid: true;
      trigger: EventTriggerDefinition;
    }
  | {
      valid: false;
      errors: string[];
    };

export function validateEventTrigger(trigger: unknown): EventTriggerValidationResult {
  const errors: string[] = [];

  if (!isRecord(trigger)) {
    return {
      valid: false,
      errors: ["trigger must be an object"]
    };
  }

  requireNonEmptyString(trigger, "id", errors);
  requireNonEmptyString(trigger, "event", errors);
  requireNonEmptyString(trigger, "flow", errors);

  if (trigger.enabled !== undefined && typeof trigger.enabled !== "boolean") {
    errors.push("enabled must be a boolean");
  }

  if (trigger.description !== undefined && typeof trigger.description !== "string") {
    errors.push("description must be a string");
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors
    };
  }

  return {
    valid: true,
    trigger: trigger as unknown as EventTriggerDefinition
  };
}

function requireNonEmptyString(target: Record<string, unknown>, field: string, errors: string[]): void {
  if (typeof target[field] !== "string" || target[field].trim().length === 0) {
    errors.push(`${field} must be a non-empty string`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
