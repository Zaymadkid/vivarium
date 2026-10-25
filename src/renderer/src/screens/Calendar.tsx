import { useMemo, useState } from "react";
import { Icon } from "../shell/icons";
import { ItemLogo } from "../shell/logo";
import { BrandLogo } from "../shell/brand";
import { formatDate, usePrefs } from "../shell/prefs";
import { Empty, Screen } from "../shell/ui";
import { Tabs } from "../shell/Tabs";

/**
 * Calendar — the reference's month grid (`CalendarView`).
 *
 * Seven columns, today in a filled accent circle with a glow, a dot per event,
 * and a day panel on the right. Week/day views are the same data at a different
 * step, so the toggle is real rather than decorative.
 */
type View = "month" | "week" | "day";

interface Event {
  id: string;
  day: number;
  title: string;
  at: string;
  agent: string;
}

const SEED: Event[] = [
  { id: "e1", day: 0, title: "Morning brief with Wren", at: "09:00", agent: "Wren" },
  { id: "e2", day: 0, title: "Automation: follow up on leads", at: "11:30", agent: "Wren" },
  { id: "e3", day: 3, title: "Review the content pipeline", at: "14:00", agent: "Wren" },
  { id: "e4", day: 6, title: "Portal sync — Alex", at: "16:15", agent: "Alex" },
  { id: "e5", day: 9, title: "Ship the onboarding doc", at: "10:00", agent: "Wren" },
];

export function CalendarScreen() {
  const [prefs] = usePrefs();
  const [view, setView] = useState<View>("month");
  const [today] = useState(() => new Date());
  const [picked, setPicked] = useState(0);

  const cells = useMemo(() => {
    const year = today.getFullYear();
    const month = today.getMonth();
    const first = new Date(year, month, 1);
    const start = (first.getDay() + 6) % 7; // Monday-first
    const days = new Date(year, month + 1, 0).getDate();
    const out: (number | null)[] = Array.from({ length: start }, () => null);
    for (let d = 1; d <= days; d++) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [today]);

  const monthLabel = today.toLocaleDateString(prefs.locale, { month: "long", year: "numeric" });
  const dayEvents = SEED.filter((e) => e.day === picked);

  return (
    <Screen
      title="Calendar"
      subtitle="What is scheduled in this world."
      actions={
        <div className="cal-actions">
          <Tabs
            label="Calendar range"
            value={view}
            onChange={setView}
            items={[
              { value: "month", label: "Month" },
              { value: "week", label: "Week" },
              { value: "day", label: "Day" },
            ]}
          />
          <button className="btn sm primary">
            <Icon name="plus" size={12} />
            New event
          </button>
        </div>
      }
    >
      <div className="cal-layout">
        <div className="cal-grid-wrap">
          <header className="cal-head">
            <h2>{monthLabel}</h2>
            <span className="cal-nav">
              <button className="icon-btn sm" aria-label="Previous month">
                <Icon name="left" size={12} />
              </button>
              <button className="icon-btn sm" aria-label="Next month">
                <Icon name="right" size={12} />
              </button>
            </span>
          </header>

          <div className="cal-weekdays">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          <div className={`cal-grid ${view !== "month" ? "compact" : ""}`}>
            {cells.slice(0, view === "month" ? cells.length : 7).map((day, i) => {
              const isToday = day === today.getDate();
              const events = SEED.filter((e) => e.day === (day ?? -1));
              return (
                <button
                  key={i}
                  className={`cal-cell ${isToday ? "today" : ""} ${picked === day ? "on" : ""}`}
                  onClick={() => day && setPicked(day)}
                  disabled={!day}
                >
                  <span className="cal-day">{day ?? ""}</span>
                  <span className="cal-dots">
                    {events.map((e) => (
                      <i key={e.id} title={e.title} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="cal-day-panel">
          <header>
            <span className="cal-day-label">
              {formatDate(new Date(today.getFullYear(), today.getMonth(), picked || 1).getTime(), prefs.locale)}
            </span>
            <span className="cal-day-count">{dayEvents.length} events</span>
          </header>

          {dayEvents.length === 0 ? (
            <Empty
              tight
              icon="clock"
              title="Nothing on this day"
              body="Ask her to schedule something, or double-click a day."
            />
          ) : (
            <ul className="cal-events">
              {dayEvents.map((e) => (
                <li key={e.id}>
                  <ItemLogo id={e.agent} label={e.agent} size={20} />
                  <div>
                    <strong>{e.title}</strong>
                    <em>
                      {e.at} · {e.agent}
                    </em>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="cal-google">
            <BrandLogo name="Google Calendar" size={18} />
            <span>Google Calendar</span>
            <em>Not connected</em>
          </div>
        </aside>
      </div>
    </Screen>
  );
}
