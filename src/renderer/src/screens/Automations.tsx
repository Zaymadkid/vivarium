import { useEffect, useMemo, useState } from "react";
import type { RoutineRecord, RoutineSchedule } from "../../../shared/types";
import { describeSchedule, toLocalInput, untilLabel } from "../../../shared/schedule";
import { Icon } from "../shell/icons";
import { ToolBrief } from "../shell/Brief";
import { pushToast } from "../shell/toasts";
import {
  Chip,
  Confirm,
  Dot,
  Empty,
  Field,
  LoadingRows,
  Menu,
  MenuRow,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "../shell/ui";

type Kind = "reminder" | "routine";
type When = RoutineSchedule["kind"];

interface Draft {
  id: string | null;
  name: string;
  kind: Kind;
  prompt: string;
  when: When;
  time: string;
  at: string;
  weekday: number;
}

const EMPTY: Draft = {
  id: null,
  name: "",
  kind: "reminder",
  prompt: "",
  when: "once",
  time: "09:00",
  at: toLocalInput(Date.now() + 60 * 60_000),
  weekday: 1,
};

function draftOf(routine: RoutineRecord): Draft {
  const schedule = routine.schedule;
  return {
    id: routine.id,
    name: routine.name,
    kind: routine.kind,
    prompt: routine.prompt,
    when: schedule.kind,
    time: schedule.kind === "once" ? "09:00" : schedule.time,
    at: schedule.kind === "once" ? toLocalInput(schedule.at) : EMPTY.at,
    weekday: schedule.kind === "weekly" ? schedule.weekday : 1,
  };
}

function scheduleOf(draft: Draft): RoutineSchedule {
  if (draft.when === "once") {
    const at = Date.parse(draft.at);
    if (!Number.isFinite(at)) throw new Error("Pick a date and time for a one-off.");
    return { kind: "once", at };
  }
  if (!/^\d{1,2}:\d{2}$/.test(draft.time)) throw new Error("The time should look like 09:30.");
  if (draft.when === "weekly") return { kind: "weekly", weekday: draft.weekday, time: draft.time };
  if (draft.when === "weekdays") return { kind: "weekdays", time: draft.time };
  return { kind: "daily", time: draft.time };
}

/**
 * Routines and reminders.
 *
 * These are not a demo: every card is a record in `routines.json`, fired by a
 * timer in the main process even when this window is closed, and a routine's
 * answer lands in the chat. Nothing here pretends to run.
 */
export function AutomationsScreen() {
  const [rows, setRows] = useState<RoutineRecord[]>([]);
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [history, setHistory] = useState<RoutineRecord | null>(null);
  const [explainer, setExplainer] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = () =>
    void window.viv.routines
      .list()
      .then((list) => {
        setRows(list);
        // Keep an open history sheet in step with the firing that just happened.
        setHistory((current) => (current ? (list.find((r) => r.id === current.id) ?? current) : current));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));

  useEffect(() => {
    load();
    const id = window.setTimeout(() => setLoading(false), 220);
    // Times move, and a reminder fired by the main process should appear here.
    const poll = window.setInterval(load, 20_000);
    const off = window.viv.routines.onFire((event) =>
      pushToast({ title: event.title, body: event.body, tone: "info" }),
    );
    return () => {
      window.clearTimeout(id);
      window.clearInterval(poll);
      off();
    };
  }, []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "on" && !r.enabled) return false;
      if (filter === "off" && r.enabled) return false;
      return !q || `${r.name} ${r.prompt}`.toLowerCase().includes(q);
    });
  }, [rows, filter, query]);

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setFormError("Give it a name so you recognise it later.");
      return;
    }
    if (!draft.prompt.trim()) {
      setFormError(draft.kind === "reminder" ? "What should the reminder say?" : "What should she be asked to do?");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const next = await window.viv.routines.save({
        id: draft.id ?? undefined,
        name: draft.name.trim(),
        kind: draft.kind,
        prompt: draft.prompt.trim(),
        schedule: scheduleOf(draft),
        enabled: true,
      });
      setRows(next);
      setDraft(null);
      pushToast({ title: draft.id ? "Saved" : "Scheduled", body: draft.name.trim(), tone: "ok" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (routine: RoutineRecord) => {
    setBusy(true);
    try {
      const next = await window.viv.routines.save({
        id: routine.id,
        name: routine.name,
        prompt: routine.prompt,
        kind: routine.kind,
        schedule: routine.schedule,
        enabled: !routine.enabled,
      });
      setRows(next);
      pushToast({ title: routine.enabled ? "Paused" : "Resumed", body: routine.name, tone: "info" });
    } finally {
      setBusy(false);
    }
  };

  const runNow = async (routine: RoutineRecord) => {
    setBusy(true);
    try {
      setRows(await window.viv.routines.run(routine.id));
      pushToast({
        title: routine.kind === "routine" ? "Asked in the chat" : "Shown",
        body: routine.name,
        tone: "ok",
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      setRows(await window.viv.routines.remove(id));
      setConfirmDelete(null);
      pushToast({ title: "Deleted", tone: "info" });
    } finally {
      setBusy(false);
    }
  };

  const on = rows.filter((r) => r.enabled).length;

  return (
    <section className="screen" aria-label="Routines">
      <header className="screen-head">
        <div className="screen-head-main">
          <h1 className="screen-title">Routines</h1>
          <p className="screen-sub">
            {rows.length} scheduled · {on} on · fires while the app runs, and keeps its place after a restart
          </p>
        </div>
        <div className="screen-actions">
          <span className="search-inline">
            <Icon name="search" size={13} />
            <input
              value={query}
              placeholder="Search routines"
              aria-label="Search routines"
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
          <button className="icon-btn" onClick={() => setExplainer(true)} aria-label="How routines work" title="How routines work">
            <Icon name="info" size={15} />
          </button>
          <button className="btn sm primary" onClick={() => setDraft({ ...EMPTY })}>
            <Icon name="plus" size={12} />
            New
          </button>
        </div>
      </header>

      <div className="screen-body">
        <ToolBrief
          does="Speaks a reminder, or asks her a prompt, at the time you choose."
          connects="A real timer in the main process; a routine's answer lands in the chat and the run is kept."
          needs="The app has to be open when it is due. A one-off that came due while it was closed fires once at the next launch."
          note="Times use this machine's clock. Reminders also appear as Windows notifications when Settings → Notifications is on."
        />

        <div className="filter-strip">
          {(
            [
              { id: "all", label: "All" },
              { id: "on", label: "On" },
              { id: "off", label: "Paused" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              className={`filter-chip ${filter === f.id ? "on" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && (
          <Empty tight icon="warn" title="Could not read the schedule" body={error} action={<button className="btn" onClick={load}>Try again</button>} />
        )}

        {loading ? (
          <LoadingRows n={3} label="Loading routines" />
        ) : rows.length === 0 ? (
          <Empty
            icon="clock"
            title="Nothing scheduled"
            body="A reminder, a routine, a time. That is all one is."
            action={
              <button className="btn primary" onClick={() => setDraft({ ...EMPTY })}>
                Create one
              </button>
            }
          />
        ) : items.length === 0 ? (
          <Empty tight icon="search" title="Nothing matches" body="Try another filter or a shorter search." />
        ) : (
          <div className="auto-grid">
            {items.map((routine) => {
              const last = routine.runs[0];
              return (
                <article key={routine.id} className={`auto-card ${routine.enabled ? "st-running" : "st-paused"}`}>
                  <header>
                    <button className="auto-title" onClick={() => setDraft(draftOf(routine))}>
                      <Dot tone={routine.enabled ? "live" : "idle"} pulse={routine.enabled} />
                      {routine.name}
                    </button>
                    <span className="menu-anchor">
                      <button
                        className="icon-btn xs"
                        aria-label={`More for ${routine.name}`}
                        onClick={() => setMenuFor(menuFor === routine.id ? null : routine.id)}
                      >
                        <Icon name="drag" size={12} />
                      </button>
                      {menuFor === routine.id && (
                        <Menu onClose={() => setMenuFor(null)} width={190}>
                          <MenuRow
                            icon="clock"
                            onClick={() => {
                              setHistory(routine);
                              setMenuFor(null);
                            }}
                          >
                            Run history
                          </MenuRow>
                          <MenuRow
                            icon={routine.enabled ? "pause" : "play"}
                            onClick={() => {
                              void toggle(routine);
                              setMenuFor(null);
                            }}
                          >
                            {routine.enabled ? "Pause" : "Resume"}
                          </MenuRow>
                          <div className="menu-rule" />
                          <MenuRow
                            icon="trash"
                            danger
                            onClick={() => {
                              setConfirmDelete(routine.id);
                              setMenuFor(null);
                            }}
                          >
                            Delete
                          </MenuRow>
                        </Menu>
                      )}
                    </span>
                  </header>

                  <div className="auto-trigger">
                    <Chip tone={routine.enabled ? "cool" : "idle"}>
                      <Icon name="clock" size={10} />
                      {describeSchedule(routine.schedule)}
                    </Chip>
                    <Chip tone={routine.kind === "routine" ? "warm" : "idle"}>
                      <Icon name={routine.kind === "routine" ? "spark" : "bell"} size={10} />
                      {routine.kind === "routine" ? "Runs a prompt" : "Reminder"}
                    </Chip>
                  </div>

                  <p className="auto-prompt">{routine.prompt}</p>

                  <footer>
                    <span className="auto-last">
                      {routine.enabled
                        ? `next ${untilLabel(routine.nextAt)} · ${new Date(routine.nextAt).toLocaleString()}`
                        : last
                          ? `last ${new Date(last.at).toLocaleString()}`
                          : "paused"}
                    </span>
                    <span className="auto-actions">
                      <button className="chipbtn" onClick={() => void runNow(routine)} disabled={busy}>
                        {routine.kind === "routine" ? "Ask now" : "Show now"}
                      </button>
                      <button className="chipbtn" onClick={() => void toggle(routine)} disabled={busy}>
                        {routine.enabled ? "Pause" : "Resume"}
                      </button>
                    </span>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {draft && (
        <Modal
          title={draft.id ? "Edit routine" : "New routine"}
          label={draft.id ? "Edit routine" : "New routine"}
          onClose={() => {
            setDraft(null);
            setFormError(null);
          }}
          width={430}
          footer={
            <>
              <button
                className="btn"
                onClick={() => {
                  setDraft(null);
                  setFormError(null);
                }}
              >
                Cancel
              </button>
              <button className="btn primary" onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : draft.id ? "Save" : "Schedule"}
              </button>
            </>
          }
        >
          <div className="form-stack">
            <Field label="Kind" help={draft.kind === "reminder" ? "A notification with these words." : "A prompt she answers in the chat."}>
              <Select
                value={draft.kind}
                onChange={(kind) => setDraft({ ...draft, kind })}
                options={[
                  { value: "reminder", label: "Reminder — say this" },
                  { value: "routine", label: "Routine — ask her to do this" },
                ]}
              />
            </Field>
            <Field label="Name">
              <TextInput value={draft.name} onChange={(name) => setDraft({ ...draft, name })} placeholder="Stand-up notes" autoFocus />
            </Field>
            <Field
              label={draft.kind === "reminder" ? "What to say" : "What to ask"}
              hint={draft.kind === "routine" ? "She gets this as a normal turn, with her tools and memory." : undefined}
            >
              <TextArea
                value={draft.prompt}
                onChange={(prompt) => setDraft({ ...draft, prompt })}
                rows={3}
                placeholder={draft.kind === "reminder" ? "Water the plants before the call." : "Summarise yesterday's notes and list the three things I owe people."}
              />
            </Field>
            <Field label="When">
              <Select
                value={draft.when}
                onChange={(when) => setDraft({ ...draft, when })}
                options={[
                  { value: "once", label: "Once" },
                  { value: "daily", label: "Every day" },
                  { value: "weekdays", label: "Weekdays" },
                  { value: "weekly", label: "Every week" },
                ]}
              />
            </Field>
            {draft.when === "once" ? (
              <Field label="At">
                <TextInput type="text" value={draft.at} onChange={(at) => setDraft({ ...draft, at })} placeholder="2026-10-25T09:30" mono />
              </Field>
            ) : (
              <Field label="Time" hint="24-hour clock, in this machine's local time.">
                <TextInput value={draft.time} onChange={(time) => setDraft({ ...draft, time })} placeholder="09:30" mono />
              </Field>
            )}
            {draft.when === "weekly" && (
              <Field label="Day">
                <Select
                  value={String(draft.weekday)}
                  onChange={(value) => setDraft({ ...draft, weekday: Number(value) })}
                  options={[
                    { value: "1", label: "Monday" },
                    { value: "2", label: "Tuesday" },
                    { value: "3", label: "Wednesday" },
                    { value: "4", label: "Thursday" },
                    { value: "5", label: "Friday" },
                    { value: "6", label: "Saturday" },
                    { value: "0", label: "Sunday" },
                  ]}
                />
              </Field>
            )}
            <Field label="Preview">
              <span className="st-mono-note">
                {(() => {
                  try {
                    return describeSchedule(scheduleOf(draft));
                  } catch (err) {
                    return err instanceof Error ? err.message : String(err);
                  }
                })()}
              </span>
            </Field>
            {formError && <p className="field-error">{formError}</p>}
          </div>
        </Modal>
      )}

      {history && (
        <Modal
          title={`History · ${history.name}`}
          label="Run history"
          onClose={() => setHistory(null)}
          width={430}
          footer={
            <button className="btn" onClick={() => setHistory(null)}>
              Close
            </button>
          }
        >
          {history.runs.length === 0 ? (
            <p className="muted">It has not run yet.</p>
          ) : (
            <div className="form-stack">
              {history.runs.map((run) => (
                <div key={run.id} className="row-between">
                  <span>{new Date(run.at).toLocaleString()}</span>
                  <span className={run.status === "ok" ? "ok-text" : "bad-text"}>{run.detail}</span>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {explainer && (
        <Modal
          title="How routines work"
          label="How routines work"
          onClose={() => setExplainer(false)}
          width={430}
          footer={
            <button className="btn" onClick={() => setExplainer(false)}>
              Close
            </button>
          }
        >
          <div className="form-stack">
            <p>
              A <b>reminder</b> shows what you wrote at the time you chose. A <b>routine</b> sends its prompt to her as a
              real turn, so she can search, use a skill, look at the screen or answer from memory.
            </p>
            <p>
              Both are stored in <span className="st-mono-note">routines.json</span> in the app's data folder and read by a
              timer in the main process. Closing this window does not stop them; quitting the app does. On the next launch,
              anything that came due once while it was closed fires once, then switches itself off.
            </p>
            <p>
              You can also ask her in the chat: “remind me at six”, “every weekday at nine summarise my inbox”. She uses the
              same records, and <span className="st-mono-note">list_reminders</span> shows what is already scheduled.
            </p>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Confirm
          title="Delete this routine?"
          body="The schedule and its history are removed. Anything it already sent stays in the chat."
          confirmLabel="Delete"
          danger
          onConfirm={() => void remove(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </section>
  );
}
