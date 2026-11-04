import { Temporal } from "@js-temporal/polyfill";

/** Date-only selections use the reporting timezone, never the server's timezone. */
export function reportPeriod(
  frequency: "weekly" | "monthly",
  now: number,
  selected?: string,
  timezone = "UTC",
) {
  const instant = Temporal.Instant.fromEpochMilliseconds(now);
  const local = instant.toZonedDateTimeISO(timezone);
  const today = local.toPlainDate();
  const date = selected ? Temporal.PlainDate.from(selected) : today;
  if (Temporal.PlainDate.compare(date, today) > 0)
    throw new Error("Choose a reporting date that is not in the future.");
  const start =
    frequency === "monthly"
      ? date.with({ day: 1 })
      : date.subtract({ days: 6 });
  const end =
    frequency === "monthly" ? start.add({ months: 1 }) : date.add({ days: 1 });
  const previousStart =
    frequency === "monthly"
      ? start.subtract({ months: 1 })
      : start.subtract({ days: 7 });
  const midnight = (d: Temporal.PlainDate) =>
    d.toZonedDateTime(timezone).epochMilliseconds;
  const complete = midnight(end) <= now;
  // Match elapsed local calendar days and clock time for an unfinished period.
  const previousEnd =
    complete ||
    (frequency === "monthly" &&
      today.since(start).days >= previousStart.daysInMonth)
      ? midnight(start)
      : previousStart
          .add({
            days: Math.min(
              today.since(start).days,
              previousStart.daysInMonth - 1,
            ),
          })
          .toPlainDateTime(local.toPlainTime())
          .toZonedDateTime(timezone).epochMilliseconds;
  return {
    start: midnight(start),
    end: midnight(end),
    asOf: Math.min(now + 1, midnight(end)),
    previousStart: midnight(previousStart),
    previousEnd,
    complete,
    timezone,
  };
}
