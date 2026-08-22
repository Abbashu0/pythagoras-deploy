export const LEGACY_SNAPSHOT_MAX_BYTES = 1024 * 1024;
export const LEGACY_ORIGIN_MAX_LENGTH = 500;
export const LEGACY_REFERENCE_MAX_LENGTH = 500;

export function resolveLegacySnapshotMaximumBytes(): number {
  const configured = Number(process.env.PYTHAGORAS_LEGACY_SNAPSHOT_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured >= 64 * 1024 && configured <= 8 * 1024 * 1024
    ? configured
    : LEGACY_SNAPSHOT_MAX_BYTES;
}
