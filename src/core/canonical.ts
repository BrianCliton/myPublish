/**
 * Canonical JSON serialization.
 *
 * Rules:
 * - Object keys sorted by Unicode code point ascending (recursive)
 * - No extra whitespace
 * - Standard JSON string escaping
 * - Numbers: standard JSON number format
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);

    case "number": {
      if (!Number.isFinite(value)) {
        throw new Error(`Cannot serialize non-finite number: ${value}`);
      }
      return JSON.stringify(value);
    }

    case "boolean":
      return value ? "true" : "false";

    case "object": {
      if (Array.isArray(value)) {
        const items = value.map((item) => serialize(item));
        return `[${items.join(",")}]`;
      }

      const obj = value as Record<string, unknown>;
      const sortedKeys = Object.keys(obj).sort();
      const pairs = sortedKeys.map(
        (key) => `${JSON.stringify(key)}:${serialize(obj[key])}`,
      );
      return `{${pairs.join(",")}}`;
    }

    case "undefined":
      throw new Error("Cannot serialize undefined value");

    default:
      throw new Error(`Cannot serialize value of type: ${typeof value}`);
  }
}
