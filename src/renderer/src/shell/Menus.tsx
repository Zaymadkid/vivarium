import { useState } from "react";
import { Icon, type IconName } from "./icons";
import { Kbd, Menu, MenuRow, Modal } from "./ui";
import { LOCALES } from "./prefs";

export interface Notice {
  id: string;
  title: string;
  body?: string;
  at: string;
  tone: "ok" | "bad" | "warn" | "info";
}

export function NotificationsPanel({
  notices,
  onClose,
  onOpenLedger,
}: {
  notices: Notice[];
  onClose: () => void;
  onOpenLedger: () => void;
}) {
  return (
    <Menu onClose={onClose} width={320} className="notifications">
      <div className="menu-head">
        <span>Notifications</span>
        <button className="menu-link" onClick={onOpenLedger}>
          Ledger
        </button>
      </div>
      {notices.length === 0 ? (
        <div className="menu-empty">
          <Icon name="bell" size={18} />
          <p>No new notifications.</p>
          <span>Finished work and failures land here.</span>
        </div>
      ) : (
        <div className="notice-list">
          {notices.map((n) => (
            <div key={n.id} className="notice">
              <i className={`dot ${n.tone === "info" ? "idle" : n.tone}`} />
              <div className="notice-main">
                <p className="notice-title">{n.title}</p>
                {n.body && <p className="notice-body">{n.body}</p>}
              </div>
              <span className="notice-time">{n.at}</span>
            </div>
          ))}
        </div>
      )}
    </Menu>
  );
}

export function LocaleMenu({
  locale,
  onPick,
  onClose,
}: {
  locale: string;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Menu onClose={onClose} width={200}>
      <div className="menu-head">
        <span>Language</span>
      </div>
      {LOCALES.map((l) => (
        <MenuRow key={l} active={l === locale} onClick={() => onPick(l)} hint={l === locale ? "accent" : undefined}>
          {l}
        </MenuRow>
      ))}
      <div className="menu-note">Dates and numbers follow this choice. Copy stays in English.</div>
    </Menu>
  );
}

export function AccountMenu({
  name,
  email,
  onClose,
  onSettings,
  onGettingStarted,
  onTour,
  onLogOut,
}: {
  name: string;
  email: string;
  onClose: () => void;
  onSettings: () => void;
  onGettingStarted: () => void;
  onTour: () => void;
  onLogOut: () => void;
}) {
  return (
    <Menu onClose={onClose} width={248}>
      <div className="menu-account">
        <span className="avatar">{initials(name)}</span>
        <div>
          <p>{name}</p>
          <span>{email || "local world"}</span>
        </div>
      </div>
      <MenuRow icon="gear" onClick={onSettings}>
        Settings
      </MenuRow>
      <MenuRow icon="spark" onClick={onGettingStarted}>
        Getting started
      </MenuRow>
      <MenuRow icon="info" onClick={onTour}>
        Help &amp; tour
      </MenuRow>
      <div className="menu-rule" />
      <MenuRow icon="slash" onClick={onLogOut} danger>
        Log out
      </MenuRow>
    </Menu>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "V";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export interface Step {
  id: string;
  label: string;
  done: boolean;
  run: () => void;
}

export function GettingStartedPanel({
  steps,
  onClose,
}: {
  steps: Step[];
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const done = steps.filter((s) => s.done).length;

  return (
    <aside className={`getting-started ${collapsed ? "collapsed" : ""}`} aria-label="Getting started">
      <header>
        <div>
          <p className="gs-title">Getting started</p>
          <span className="gs-sub">
            {done === steps.length ? "All done" : `${done} of ${steps.length} · Your next steps are here`}
          </span>
        </div>
        <div className="gs-head-actions">
          <button className="icon-btn sm" onClick={() => setCollapsed((v) => !v)} aria-label="Collapse">
            <Icon name={collapsed ? "down" : "up"} size={12} />
          </button>
          <button className="icon-btn sm" onClick={onClose} aria-label="Put this away">
            <Icon name="close" size={12} />
          </button>
        </div>
      </header>
      {!collapsed && (
        <>
          <ul className="gs-steps">
            {steps.map((s) => (
              <li key={s.id}>
                <i className={`dot ${s.done ? "live" : "warm"}`} />
                <span className="gs-step-label">{s.label}</span>
                <button className={`btn sm ${s.done ? "ghost" : ""}`} onClick={s.run}>
                  {s.done ? "Done" : "Open"}
                </button>
              </li>
            ))}
          </ul>
          <p className="gs-foot">Tap a step to open it</p>
        </>
      )}
    </aside>
  );
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘", "K"], label: "Jump to a companion or view" },
  { keys: ["⌘", "J"], label: "Open or close the chat drawer" },
  { keys: ["⌘", "."], label: "Open the console" },
  { keys: ["Space"], label: "Push to talk" },
  { keys: ["←", "→"], label: "Walk between places" },
  { keys: ["Esc"], label: "Close whatever is open" },
];

const TOUR: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "target",
    title: "The world is the room",
    body: "Companions stand in it. Their state reads from across the room; the console is the only place that lists work.",
  },
  {
    icon: "hand",
    title: "You hold the hands",
    body: "Folders, shell commands and money all need you. Auto mode skips the ask for reads and writes, never for deletes or sends.",
  },
  {
    icon: "brain",
    title: "Nothing leaves this machine",
    body: "Provider, key and history stay local. The ledger records every action an agent took.",
  },
];

export function HelpTour({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Help & tour"
      onClose={onClose}
      width={460}
      footer={
        <button className="btn primary" onClick={onClose}>
          Take the tour
        </button>
      }
    >
      <p className="modal-lede">
        Three things worth knowing before the first run. Everything here works with the keyboard.
      </p>
      <ul className="tour-list">
        {TOUR.map((t) => (
          <li key={t.title}>
            <span className="tour-icon">
              <Icon name={t.icon} size={15} />
            </span>
            <div>
              <p>{t.title}</p>
              <span>{t.body}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="shortcut-grid">
        {SHORTCUTS.map((s) => (
          <div key={s.label}>
            <span>
              {s.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
            <em>{s.label}</em>
          </div>
        ))}
      </div>
    </Modal>
  );
}
