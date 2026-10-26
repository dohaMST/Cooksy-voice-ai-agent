/**
 * Week arithmetic for the Kitchen view.
 *
 * Dates are ISO `YYYY-MM-DD` strings because that is what cooksy-api stores and
 * compares with `$gte`/`$lte`, and a plain string comparison is the same order as
 * the calendar. Weeks start on Monday, matching `weekStart()` in cooksy-api.
 *
 * Formatting is done by hand rather than with `toLocaleDateString`: the console is
 * server-rendered, and a locale-dependent label would differ between the Node
 * process and the browser and trip hydration.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function iso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Monday..Sunday of the week `offset` weeks from the week containing `today`. */
export function weekRange(offset = 0, today = new Date()): { from: string; to: string } {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = monday.getDay(); // 0 = Sunday
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day) + offset * 7);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
}

/** `19 – 25 Oct`, or `28 Sep – 4 Oct` when the week straddles two months. */
export function formatRange(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${from} → ${to}`;
  const left =
    start.getMonth() === end.getMonth()
      ? String(start.getDate())
      : `${start.getDate()} ${MONTHS[start.getMonth()]}`;
  return `${left} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
}

/** `Tue 27 Oct`: one date, for a confirmation line in the conversation. */
export function formatDay(date: string): string {
  if (!ISO_DATE.test(date)) return date;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${DAYS[parsed.getDay()]} ${parsed.getDate()} ${MONTHS[parsed.getMonth()]}`;
}

/**
 * How many weeks `date` sits from the week containing `today`. This is what keeps
 * an approved write visible: a meal for next Tuesday must open the Week tab on
 * next week instead of leaving the operator staring at an empty "this week".
 */
export function weekOffsetFor(date: string, today = new Date()): number {
  if (!ISO_DATE.test(date)) return 0;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return 0;
  const current = weekRange(0, today).from;
  const target = weekRange(0, parsed).from;
  // Both sides are date-only Mondays, so measure them in UTC: a DST change would
  // otherwise make a 7-day difference read as 6.96 days and round the wrong way.
  const utc = (iso: string) =>
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((utc(target) - utc(current)) / (7 * 24 * 60 * 60 * 1000));
}
