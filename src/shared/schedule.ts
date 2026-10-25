import type { RoutineSchedule } from "./types";

/**
 * WHEN THE NEXT ONE IS DUE.
 *
 * Pure local-clock arithmetic, shared by the store, the scheduler and the window
 * that previews a schedule. No cron library: four shapes are enough for a
 * reminder, and everyone can read them.
 */

const pad = (n: number) => String(n).padStart(2, "0");

function timeOf(time: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const hours = match ? Math.min(23, Math.max(0, Number(match[1]))) : 9;
  const minutes = match ? Math.min(59, Math.max(0, Number(match[2]))) : 0;
  return { hours, minutes };
}

export function nextRunAt(schedule: RoutineSchedule, from = Date.now()): number {
  if (schedule.kind === "once") return Math.max(0, Math.round(schedule.at));
  const { hours, minutes } = timeOf(schedule.time);
  const start = new Date(from);
  const candidate = (dayOffset: number) => {
    const day = new Date(start);
    day.setDate(day.getDate() + dayOffset);
    day.setHours(hours, minutes, 0, 0);
    return day.getTime();
  };
  // A minute of slack: saving at 09:00:30 for 09:00 should mean tomorrow, not
  // fire immediately behind the save.
  const floor = from + 20_000;
  for (let offset = 0; offset <= 9; offset += 1) {
    const at = candidate(offset);
    const day = new Date(at).getDay();
    if (schedule.kind === "weekly" && day !== Math.min(6, Math.max(0, Math.round(schedule.weekday)))) continue;
    if (schedule.kind === "weekdays" && (day === 0 || day === 6)) continue;
    if (at > floor) return at;
  }
  return candidate(7);
}

export function describeSchedule(schedule: RoutineSchedule, locale = "en-US"): string {
  if (schedule.kind === "once") {
    return new Date(schedule.at).toLocaleString(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (schedule.kind === "daily") return `Every day at ${schedule.time}`;
  if (schedule.kind === "weekdays") return `Weekdays at ${schedule.time}`;
  const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    Math.min(6, Math.max(0, Math.round(schedule.weekday)))
  ];
  return `Every ${day} at ${schedule.time}`;
}

/** `HH:MM` for a datetime-local input, in this machine's clock. */
export function toLocalInput(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A short, human "in 2h" / "tomorrow" line for the card. */
export function untilLabel(at: number, now = Date.now()): string {
  const diff = at - now;
  if (diff <= 0) return "due now";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} d`;
}
