import type { AIContextTokenEstimator } from "../context";

/**
 * Runtime plan values must be detached from repository/caller-owned objects.
 * This helper intentionally stays in-memory; it is not a persistence codec.
 */
export function cloneAndDeepFreeze<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

export function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
  if (Object.isFrozen(value)) return value;
  for (const child of Reflect.ownKeys(value as object)) {
    const childValue = (value as Record<PropertyKey, unknown>)[child];
    if (childValue !== null && typeof childValue === "object") deepFreeze(childValue);
  }
  return Object.freeze(value);
}

export function captureEstimator(estimator: AIContextTokenEstimator): AIContextTokenEstimator {
  const estimate = estimator.estimate;
  return Object.freeze({ estimatorKey: estimator.estimatorKey, estimate });
}
