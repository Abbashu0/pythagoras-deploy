import { ChangeManagementError } from "./errors";
import type { ChangeSnapshot, ChangeSnapshotValue } from "./contracts";

export const MAX_CHANGE_SNAPSHOT_BYTES = 64 * 1024;

export function getChangeSnapshotByteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function isPlainObject(value: unknown): value is ChangeSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value: unknown, path: string): asserts value is ChangeSnapshotValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (!key || key.includes(".")) {
        throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", `Snapshot key is invalid at ${path}.`);
      }
      assertJsonValue(child, path ? `${path}.${key}` : key);
    }
    return;
  }
  throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", `Snapshot contains a non-JSON value at ${path || "$"}.`);
}

export function validateChangeSnapshot(value: unknown): asserts value is ChangeSnapshot {
  if (!isPlainObject(value)) {
    throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "A change snapshot must be a plain JSON object.");
  }
  assertJsonValue(value, "");
  const bytes = getChangeSnapshotByteSize(value);
  if (bytes > MAX_CHANGE_SNAPSHOT_BYTES) {
    throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", `A change snapshot exceeds ${MAX_CHANGE_SNAPSHOT_BYTES} bytes.`);
  }
}

export function cloneSnapshot<T extends ChangeSnapshot>(snapshot: T): T {
  validateChangeSnapshot(snapshot);
  return structuredClone(snapshot);
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function deriveChangedPaths(before: ChangeSnapshot, after: ChangeSnapshot): string[] {
  validateChangeSnapshot(before);
  validateChangeSnapshot(after);
  const paths: string[] = [];

  const walk = (left: unknown, right: unknown, path: string) => {
    if (equalJson(left, right)) return;
    if (Array.isArray(left) || Array.isArray(right)) {
      paths.push(path || "$");
      return;
    }
    if (isPlainObject(left) && isPlainObject(right)) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      for (const key of keys) walk(left[key], right[key], path ? `${path}.${key}` : key);
      return;
    }
    paths.push(path || "$");
  };

  walk(before, after, "");
  return [...new Set(paths)].sort();
}

function pathsOverlap(left: string, right: string): boolean {
  if (left === "$" || right === "$") return true;
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
}

function readPath(snapshot: ChangeSnapshot, path: string): ChangeSnapshotValue | undefined {
  if (path === "$") return snapshot;
  let current: ChangeSnapshotValue | undefined = snapshot;
  for (const segment of path.split(".")) {
    if (!isPlainObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function writePath(target: ChangeSnapshot, path: string, value: ChangeSnapshotValue | undefined): void {
  if (path === "$") throw new ChangeManagementError("CHANGE_CONFLICT", "A root snapshot change cannot be auto-merged.");
  const segments = path.split(".");
  let current: ChangeSnapshot = target;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!isPlainObject(next)) current[segment] = {};
    current = current[segment] as ChangeSnapshot;
  }
  const key = segments.at(-1)!;
  if (value === undefined) delete current[key];
  else current[key] = structuredClone(value);
}

export interface ThreeWayMergeResult {
  kind: "clean" | "auto-merged" | "conflict";
  finalSnapshot: ChangeSnapshot | null;
  currentChangedPaths: string[];
  overlappingPaths: string[];
}

export function threeWayMerge(
  base: ChangeSnapshot,
  current: ChangeSnapshot,
  proposed: ChangeSnapshot,
  proposalChangedPaths = deriveChangedPaths(base, proposed),
): ThreeWayMergeResult {
  const currentChangedPaths = deriveChangedPaths(base, current);
  if (currentChangedPaths.length === 0) {
    return { kind: "clean", finalSnapshot: cloneSnapshot(proposed), currentChangedPaths, overlappingPaths: [] };
  }
  const overlappingPaths = proposalChangedPaths.filter((proposalPath) =>
    currentChangedPaths.some((currentPath) => pathsOverlap(proposalPath, currentPath)),
  );
  if (overlappingPaths.length > 0) {
    return { kind: "conflict", finalSnapshot: null, currentChangedPaths, overlappingPaths };
  }
  const merged = cloneSnapshot(current);
  for (const path of proposalChangedPaths) writePath(merged, path, readPath(proposed, path));
  return { kind: "auto-merged", finalSnapshot: merged, currentChangedPaths, overlappingPaths: [] };
}
