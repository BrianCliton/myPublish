export interface DiffEntry {
  path: string;
  type: "added" | "removed" | "modified";
  oldValue?: unknown;
  newValue?: unknown;
  breaking: boolean; // true = field removed or type changed
}

function recurse(a: unknown, b: unknown, path: string, out: DiffEntry[]): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return;

  const aIsPlainObj = typeof a === "object" && a !== null && !Array.isArray(a);
  const bIsPlainObj = typeof b === "object" && b !== null && !Array.isArray(b);

  if (aIsPlainObj && bIsPlainObj) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    for (const k of Object.keys(ao)) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in bo)) {
        out.push({ path: p, type: "removed", oldValue: ao[k], breaking: true });
      } else {
        recurse(ao[k], bo[k], p, out);
      }
    }
    for (const k of Object.keys(bo)) {
      if (!(k in ao)) {
        const p = path ? `${path}.${k}` : k;
        out.push({ path: p, type: "added", newValue: bo[k], breaking: false });
      }
    }
    return;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const p = `${path}[${i}]`;
      if (i >= a.length) out.push({ path: p, type: "added", newValue: b[i], breaking: false });
      else if (i >= b.length) out.push({ path: p, type: "removed", oldValue: a[i], breaking: true });
      else recurse(a[i], b[i], p, out);
    }
    return;
  }

  out.push({ path, type: "modified", oldValue: a, newValue: b, breaking: typeof a !== typeof b });
}

export function computeDiff(oldConfig: unknown, newConfig: unknown): DiffEntry[] {
  const out: DiffEntry[] = [];
  recurse(oldConfig, newConfig, "", out);
  return out;
}
