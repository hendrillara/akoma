// When a deferred change takes effect, from the act's DOU publication date and its vigência clause (ADR 0003).
// Dates are calendar days in Brasília, handled as plain year/month/day numbers: no time zone can shift them.
import type { When } from "./acts.ts";

/**
 * - "após decorridos N dias de sua publicação": LC 95/1998 art. 8º § 1º counts the publication day and the last day,
 *   and the act is in force on the day after: publication + N days.
 * - "após decorridos N meses/anos": the period ends on the corresponding day N months/years later (Lei 810/1949
 *   arts. 2º–3º: the first day after it when that month has no such day), and the act is in force on the next day.
 *   EC 141, DOU 16.10.2026, 2 months: ends 16.12.2026, in force 2026-12-17.
 * - "em 2027": 1 January of that year, the first day the clause allows (an interpretation, flagged in ADR 0003).
 */
export function effectiveDate(when: Exclude<When, "publication">, published: string): string {
  if ("year" in when) return `${when.year}-01-01`;
  const [y, m, d] = published.split("-").map(Number) as [number, number, number];
  if (when.unit === "dias") return iso(addDays({ y, m, d }, when.after));
  const months = when.unit === "anos" ? when.after * 12 : when.after;
  const total = (m - 1) + months;
  const end = { y: y + Math.floor(total / 12), m: (total % 12) + 1, d };
  // No corresponding day (31 → a 30-day month): the period ends on the first day of the next month.
  const last = d > daysIn(end.y, end.m) ? addDays({ ...end, d: daysIn(end.y, end.m) }, 1) : end;
  return iso(addDays(last, 1));
}

/** Whether a YYYY-MM-DD string is a real calendar date. */
export function isCalendarDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo);
}

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function addDays({ y, m, d }: Ymd, days: number): Ymd {
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function iso({ y, m, d }: Ymd): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * The calendar day in Brasília of an instant (where a norm takes effect at the start of the day), or the day itself
 * when only a capture day is known ("2026-10-20").
 */
export function brasiliaDay(instant: Date | string): string {
  if (typeof instant === "string" && /^\d{4}-\d{2}-\d{2}$/.test(instant)) return instant;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(typeof instant === "string" ? new Date(instant) : instant);
}
