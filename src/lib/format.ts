/* ============================================================================
   Number / date / byte formatting.
   The admin is Arabic-first but numbers stay Latin ("ar-IQ" with latn digits)
   because operators scan IDs, costs and counts constantly and Arabic-Indic
   digits hurt scannability next to technical identifiers.
   ========================================================================== */

const LOCALE = "ar-IQ-u-nu-latn";
const LOCALE_EN = "en-US";

const cache = new Map<string, Intl.NumberFormat>();

function nf(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, options);
    cache.set(key, f);
  }
  return f;
}

/** 12482 → "12,482" */
export function formatNumber(
  value: number,
  options: { decimals?: number; signed?: boolean } = {},
): string {
  const { decimals = 0, signed = false } = options;
  return nf(`n-${decimals}-${signed}`, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(value);
}

/** 12482 → "12.5K" — for axis ticks and dense metric rows. */
export function formatCompact(value: number, decimals = 1): string {
  if (Math.abs(value) < 1000) return formatNumber(value);
  return nf(`c-${decimals}`, {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: decimals,
  }).format(value);
}

/** 0.964 → "96.4%" */
export function formatPercent(
  value: number,
  options: { decimals?: number; alreadyScaled?: boolean; signed?: boolean } = {},
): string {
  const { decimals = 1, alreadyScaled = false, signed = false } = options;
  const v = alreadyScaled ? value / 100 : value;
  return nf(`p-${decimals}-${signed}`, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(v);
}

/** 12.4823 → "$12.48". Sub-cent values keep more precision so per-request
 *  costs never collapse to "$0.00". */
export function formatCurrency(
  value: number,
  options: { currency?: string; decimals?: number; compact?: boolean } = {},
): string {
  const { currency = "USD", compact = false } = options;
  let decimals = options.decimals;
  if (decimals == null) {
    const abs = Math.abs(value);
    decimals = abs === 0 ? 2 : abs < 0.01 ? 5 : abs < 1 ? 4 : 2;
  }
  return new Intl.NumberFormat(LOCALE_EN, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    notation: compact && Math.abs(value) >= 10000 ? "compact" : "standard",
  }).format(value);
}

/** 1_284_000 → "1.28M tok" style token counts. */
export function formatTokens(value: number): string {
  return formatCompact(value, value >= 1_000_000 ? 2 : 1);
}

/** 1536 → "1.5 KB" */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)),
    units.length - 1,
  );
  const v = bytes / Math.pow(1024, i);
  return `${formatNumber(v, { decimals: i === 0 ? 0 : decimals })} ${units[i]}`;
}

/** 842 → "842ms", 2400 → "2.4s" */
export function formatDuration(ms: number): string {
  if (ms < 1) return `${formatNumber(ms * 1000, { decimals: 0 })}µs`;
  if (ms < 1000) return `${formatNumber(ms, { decimals: 0 })}ms`;
  if (ms < 60_000) return `${formatNumber(ms / 1000, { decimals: 1 })}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  if (min < 60) return sec ? `${min}د ${sec}ث` : `${min}د`;
  const h = Math.floor(min / 60);
  return `${h}س ${min % 60}د`;
}

/** Context window sizes: 131072 → "128K" */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000)
    return `${formatNumber(tokens / 1_048_576, { decimals: tokens % 1_048_576 === 0 ? 0 : 1 })}M`;
  if (tokens >= 1024)
    return `${formatNumber(Math.round(tokens / 1024), { decimals: 0 })}K`;
  return formatNumber(tokens);
}

/* ---------------------------------------------------------------------------
   Dates
   Human-readable label first, exact timestamp available in a tooltip.
   ------------------------------------------------------------------------ */

const dtFull = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: "full",
  timeStyle: "medium",
});
const dtShort = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const dtDay = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "short",
});
const dtTime = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
});
const dtDateTime = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDate(value: Date | string | number): string {
  return dtShort.format(toDate(value));
}

export function formatDayMonth(value: Date | string | number): string {
  return dtDay.format(toDate(value));
}

export function formatTime(value: Date | string | number): string {
  return dtTime.format(toDate(value));
}

export function formatDateTime(value: Date | string | number): string {
  return dtDateTime.format(toDate(value));
}

/** The exact, unambiguous string shown in tooltips. */
export function formatExact(value: Date | string | number): string {
  return dtFull.format(toDate(value));
}

/** "قبل ٣ دقائق" style relative label. */
export function formatRelative(
  value: Date | string | number,
  now: Date | number = Date.now(),
): string {
  const then = toDate(value).getTime();
  const diffSec = Math.round((then - new Date(now).getTime()) / 1000);
  const abs = Math.abs(diffSec);

  if (abs < 45) return diffSec >= 0 ? "الآن" : "قبل لحظات";

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.35],
    ["month", 12],
    ["year", Number.POSITIVE_INFINITY],
  ];

  let v = diffSec;
  for (const [unit, step] of units) {
    if (Math.abs(v) < step) {
      return new Intl.RelativeTimeFormat(LOCALE, {
        numeric: "auto",
        style: "long",
      }).format(Math.round(v), unit);
    }
    v = v / step;
  }
  return formatDate(value);
}

/** Compact relative label for dense tables: "٣د", "٥س", "٢ي". */
export function formatRelativeShort(
  value: Date | string | number,
  now: Date | number = Date.now(),
): string {
  const diff = new Date(now).getTime() - toDate(value).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "الآن";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} د`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} س`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} ي`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo} ش`;
  return `${Math.round(mo / 12)} سنة`;
}

/** "١٢ – ١٨ أيار" for range selectors. */
export function formatDateRange(
  from: Date | string | number,
  to: Date | string | number,
): string {
  return `${formatDayMonth(from)} – ${formatDate(to)}`;
}

/* ---------------------------------------------------------------------------
   Text
   ------------------------------------------------------------------------ */

/** Middle-ellipsis for long technical identifiers where both ends matter. */
export function truncateMiddle(value: string, max = 28): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

/** Rough token estimate used by instruction/policy editors (≈4 chars/token
 *  for Latin, ≈2.2 for Arabic). Presentational only. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const arabic = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const other = text.length - arabic;
  return Math.ceil(arabic / 2.2 + other / 4);
}

export function pluralAr(
  count: number,
  forms: { zero?: string; one: string; two?: string; few: string; many: string },
): string {
  if (count === 0 && forms.zero) return forms.zero;
  if (count === 1) return forms.one;
  if (count === 2) return forms.two ?? forms.few;
  if (count % 100 >= 3 && count % 100 <= 10) return forms.few;
  return forms.many;
}
