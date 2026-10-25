import { useEffect, useMemo, useState } from "react";
import type { IntegrationStatus, SkillRecord, UsageReport } from "../../../shared/types";
import { Icon } from "../shell/icons";
import { ItemLogo } from "../shell/logo";
import { useDb } from "../shell/data";
import { Chip, Dot, Screen, SectionLabel } from "../shell/ui";

/**
 * Dashboard — the reference's widget grid (`DashboardView` / `ConsumerDashboard`).
 *
 * One card per system, each with its own logo tile, a 10 px uppercase header and
 * a short list. Cards stagger in on mount; the hero number is re-keyed so a
 * refresh ticks instead of sitting still.
 */
export function DashboardScreen({
  agents,
  onOpen,
}: {
  agents: { id: string; name: string; state: string }[];
  onOpen: (id: string) => void;
}) {
  const [db] = useDb();
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [usage, setUsage] = useState<UsageReport | null>(null);

  useEffect(() => {
    void Promise.all([
      window.viv.skills.list(),
      window.viv.integrations.scan().catch(() => [] as IntegrationStatus[]),
      window.viv.usage.get(),
    ]).then(([learned, measured, report]) => {
      setSkills(learned);
      setIntegrations(measured);
      setUsage(report);
    });
  }, []);

  const widgets = useMemo(
    () => [
      {
        id: "companions",
        title: "Companions",
        value: agents.length,
        unit: "in this world",
        rows: agents.slice(0, 4).map((a) => ({ id: a.id, label: a.name, meta: a.state })),
        open: "world",
      },
      {
        id: "documents",
        title: "Documents",
        value: db.docs.length,
        unit: "entries",
        rows: db.docs.slice(0, 4).map((d) => ({
          id: d.id,
          label: d.title,
          meta: db.folders.find((f) => f.id === d.folderId)?.name ?? "Unfiled",
        })),
        open: "documents",
      },
      {
        id: "skills",
        title: "Skills",
        value: skills.length,
        unit: "saved",
        rows: skills.slice(0, 4).map((s) => ({ id: s.id, label: s.name, meta: s.source === "learned" ? "learned" : "yours" })),
        open: "skills",
      },
      {
        id: "automations",
        title: "Automations",
        value: db.automations.filter((a) => a.status === "running").length,
        unit: "running",
        rows: db.automations.slice(0, 4).map((a) => ({ id: a.id, label: a.name, meta: a.status })),
        open: "automations",
      },
      {
        id: "integrations",
        title: "Integrations",
        value: integrations.filter((i) => i.status === "ready").length,
        unit: "ready",
        rows: integrations.slice(0, 4).map((i) => ({ id: i.id, label: i.name, meta: i.status })),
        open: "integrations",
      },
      {
        id: "portals",
        title: "Portals",
        value: db.portals.length,
        unit: "open",
        rows: db.portals.slice(0, 4).map((p) => ({ id: p.id, label: p.partner, meta: p.status })),
        open: "portals",
      },
    ],
    [agents, db, skills, integrations],
  );

  const runs = useMemo(
    () =>
      db.automations
        .flatMap((a) => a.runs.map((r) => ({ ...r, name: a.name })))
        .sort((a, b) => b.at - a.at)
        .slice(0, 6),
    [db.automations],
  );

  return (
    <Screen
      title="Dashboard"
      subtitle="Everything in this world, on one board."
      actions={
        <span className="dash-credits">
          <Icon name="receipt" size={12} />
          {usage?.usage.runs ?? 0} runs · {usage?.memories ?? 0} memories
        </span>
      }
    >
      <div className="dash-grid">
        {widgets.map((w, i) => (
          <article className="dash-card" key={w.id} style={{ animationDelay: `${i * 45}ms` }}>
            <header>
              <ItemLogo id={w.id} label={w.title} size={22} />
              <span className="dash-title">{w.title}</span>
              <Chip tone="idle">{w.unit}</Chip>
            </header>

            <div className="dash-value" key={w.value}>
              {w.value}
            </div>

            <ul className="dash-rows">
              {w.rows.length === 0 && <li className="dash-empty">Nothing here yet.</li>}
              {w.rows.map((r) => (
                <li key={r.id}>
                  <Dot tone="idle" />
                  <span>{r.label}</span>
                  <em>{r.meta}</em>
                </li>
              ))}
            </ul>

            <button className="dash-open" onClick={() => onOpen(w.open)}>
              Open
              <Icon name="right" size={11} />
            </button>
          </article>
        ))}
      </div>

      <SectionLabel>Recent runs</SectionLabel>
      <div className="dash-log">
        {runs.length === 0 && <p className="muted">No runs yet — ask her to do something.</p>}
        {runs.map((r) => (
          <div className="dash-log-row" key={`${r.name}-${r.id}`}>
            <ItemLogo id={r.name} label={r.name} size={16} />
            <span>{r.name}</span>
            <em>{r.duration}</em>
            <Chip tone={r.status === "ok" ? "live" : r.status === "failed" ? "bad" : "warn"}>
              {r.status}
            </Chip>
          </div>
        ))}
      </div>
    </Screen>
  );
}
