export function buildPublicRichContentAssetUrl(assetId: string): string {
  return `/api/content/assets/${encodeURIComponent(assetId)}`;
}

export function buildAdminRichContentAssetUrl(assetId: string): string {
  return `/api/admin/assets/${encodeURIComponent(assetId)}/content`;
}

export function assertSafePresentationAssetUrl(value: string): string {
  if (!value || /[\u0000-\u001f\u007f\\]/u.test(value)) {
    throw new Error("Rich Content asset URL is invalid.");
  }

  if (value.startsWith("/") && !value.startsWith("//")) return value;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Rich Content asset URL is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Rich Content asset URL must be same-origin or HTTPS.");
  }
  return value;
}
