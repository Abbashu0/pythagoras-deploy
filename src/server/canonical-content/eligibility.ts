export interface CanonicalBannerEligibilityInput {
  status: string;
  assetId: string | null;
  assetMimeType: string | null;
  startsAt: number | null;
  endsAt: number | null;
}

function validTimestamp(value: number | null): value is number | null {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

/**
 * The single server-owned definition of a banner that may enter Student
 * content. Admin diagnostics may show any canonical row, but public content
 * must use this predicate before applying the five-item carousel cap.
 */
export function isStudentVisibleBanner(
  banner: CanonicalBannerEligibilityInput,
  now: number = Date.now(),
): boolean {
  if (
    banner.status !== "ACTIVE" ||
    !banner.assetId ||
    !banner.assetMimeType?.startsWith("image/") ||
    !validTimestamp(banner.startsAt) ||
    !validTimestamp(banner.endsAt) ||
    !Number.isSafeInteger(now) ||
    now < 0
  ) {
    return false;
  }

  return (
    (banner.startsAt === null || banner.startsAt <= now) &&
    (banner.endsAt === null || banner.endsAt > now)
  );
}
