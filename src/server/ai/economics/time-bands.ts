import { AIAccountingError } from "./errors";

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;

export function getZonedWeekdayAndMinute(
  timestamp: number,
  timeZone: string,
): { weekday: number; minute: number } {
  if (!Number.isSafeInteger(timestamp) || Math.abs(timestamp) > MAX_DATE_MILLISECONDS) {
    throw new AIAccountingError("AI_RATE_CARD_INVALID", "The pricing timestamp is outside the runtime date range.");
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = WEEKDAY_INDEX[values.weekday];
  const hour = Number(values.hour) === 24 ? 0 : Number(values.hour);
  const minute = Number(values.minute);
  if (weekday === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new AIAccountingError("AI_RATE_CARD_INVALID", "The configured timezone did not produce a usable local time.");
  }
  return { weekday, minute: hour * 60 + minute };
}
