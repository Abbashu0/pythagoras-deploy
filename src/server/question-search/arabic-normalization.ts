/** Search-only normalization. It intentionally preserves ى/ي, ؤ/و and ئ/ي. */
const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu;
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeArabicSearchText(value: string): string {
  let result = value.normalize("NFKC").replace(DIACRITICS, "").replace(/ـ/gu, "");
  result = result.replace(/[أإآٱ]/gu, "ا");
  result = result.replace(/[٠-٩]/gu, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
  result = result.replace(/[۰-۹]/gu, (digit) => String(PERSIAN_DIGITS.indexOf(digit)));
  return result.toLocaleLowerCase("und").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

export function tokenizeArabicSearchText(value: string): string[] {
  const normalized = normalizeArabicSearchText(value);
  return normalized ? normalized.split(" ") : [];
}

/** Produces FTS syntax solely from normalized word tokens, never raw input. */
export function buildSafeFtsPrefixQuery(value: string): { normalizedQuery: string; match: string } | null {
  const normalizedQuery = normalizeArabicSearchText(value);
  const tokens = normalizedQuery ? normalizedQuery.split(" ") : [];
  if (!tokens.length) return null;
  return { normalizedQuery, match: tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ") };
}
