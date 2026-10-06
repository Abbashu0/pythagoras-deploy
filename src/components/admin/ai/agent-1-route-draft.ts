/** Pure draft operations. Saving the route remains an explicit Admin mutation. */
export function reorderFallbacks(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return next;
  const [id] = next.splice(from, 1); next.splice(to, 0, id);
  return next;
}

export function promoteFallback(primary: string | null, ids: readonly string[], index: number) {
  if (index < 0 || index >= ids.length) return { primary, fallbacks: [...ids] };
  return { primary: ids[index], fallbacks: ids.flatMap((id, i) => i === index ? primary ? [primary] : [] : [id]) };
}
