export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString("ar-IQ")} بايت`;
  const units = ["ك.ب", "م.ب", "ج.ب", "ت.ب"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString("ar-IQ", { maximumFractionDigits: value >= 10 ? 1 : 2 })} ${units[unit]}`;
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("ar-IQ", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function formatDimensions(width: number | null, height: number | null): string {
  return width && height ? `${width.toLocaleString("ar-IQ")} × ${height.toLocaleString("ar-IQ")}` : "—";
}
