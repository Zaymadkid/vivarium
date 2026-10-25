import { useState } from "react";
import type { Settings } from "../../../shared/types";
import { Icon } from "../shell/icons";
import { SECTIONS, SectionBody, type SectionProps } from "../Panels";
import { Empty } from "../shell/ui";

export function SettingsScreen({
  settings,
  patch,
  info,
  agentName,
  onRenameAgent,
  onOpen,
  onRefresh,
  initial,
}: {
  settings: Settings;
  patch: (next: Partial<Settings>) => void;
  info: SectionProps["info"];
  agentName: string;
  onRenameAgent: (name: string) => void;
  onOpen: (id: string) => void;
  onRefresh: () => void;
  initial?: string;
}) {
  const [active, setActive] = useState(initial ?? "prefs");
  const [query, setQuery] = useState("");

  const groups: { label: string; ids: string[] }[] = [
    { label: "This world", ids: ["prefs", "companion", "world"] },
    { label: "Mind & hands", ids: ["mind", "hands", "files"] },
    { label: "Work", ids: ["documents", "notif"] },
    { label: "Account", ids: ["billing", "account", "machine", "advanced"] },
  ];

  const needle = query.trim().toLowerCase();
  const matches = SECTIONS.filter(
    (s) => !needle || `${s.title} ${s.blurb}`.toLowerCase().includes(needle),
  );

  // A cross-link inside a pane (e.g. Account → Advanced) selects a section here;
  // anything else is a real route change.
  const go = (id: string) => {
    if (SECTIONS.some((s) => s.id === id)) {
      setActive(id);
      return;
    }
    onOpen(id);
  };

  return (
    <section className="screen flush" aria-label="Settings">
      <header className="screen-head">
        <div className="screen-head-main">
          <h1 className="screen-title">Settings</h1>
          <p className="screen-sub">Every setting in one place · saved on this machine</p>
        </div>
        <div className="screen-actions">
          <span className="search-inline">
            <Icon name="search" size={13} />
            <input
              value={query}
              placeholder="Search settings"
              aria-label="Search settings"
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
          <button
            className="btn sm ghost"
            onClick={() => void window.viv.data.openDataDir()}
            title={info?.dataDir}
          >
            <Icon name="folder" size={12} />
            Data folder
          </button>
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-rail" aria-label="Settings sections">
          {groups.map((g) => (
            <div key={g.label} className="rail-group">
              <span className="rail-group-label">{g.label}</span>
              {g.ids.map((id) => {
                const section = matches.find((s) => s.id === id);
                if (!section) return null;
                return (
                  <button
                    key={id}
                    className={`rail-row ${active === id ? "on" : ""}`}
                    onClick={() => setActive(id)}
                    title={`${section.title} — ${section.blurb}`}
                    aria-label={section.title}
                    aria-current={active === id ? "page" : undefined}
                  >
                    <span className="rail-icon">
                      <Icon name={section.icon} size={13} />
                    </span>
                    <span>{section.title}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="settings-pane">
          {needle && matches.length === 0 ? (
            <Empty
              icon="search"
              title="No section matches that"
              body={`Nothing in the rail matches “${query.trim()}”.`}
              action={
                <button className="btn sm" onClick={() => setQuery("")}>
                  Clear search
                </button>
              }
            />
          ) : (
            <SectionBody
              id={active}
              props={{
                settings,
                patch,
                info,
                agentName,
                onRenameAgent,
                onOpen: go,
                onRefresh,
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}

