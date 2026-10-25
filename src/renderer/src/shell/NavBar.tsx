import { Icon, type IconName } from "./icons";

export interface NavItem {
  id: string;
  label: string;
}

/** The dock reads at a glance: a small mark for each place, not just a word. */
const MARK: Record<string, IconName> = {
  chat: "wave",
  console: "cpu",
  configure: "sliders",
  world: "globe",
  dashboard: "grid",
  calendar: "clock",
  documents: "file",
  skills: "skill",
  integrations: "plug",
  automations: "refresh",
  live: "mic",
  screen: "screen",
  portals: "box",
  tools: "sliders",
  team: "users",
  settings: "gear",
  marketplace: "tag",
  credits: "receipt",
};

/**
 * A flat row of pressed-state buttons. There is no shared-layout sliding
 * highlight — the lit state is a styled pill, not an indicator that animates
 * between items.
 */
export function NavBar({
  items,
  active,
  onPick,
  entries,
  onLedger,
  ledgerActive,
}: {
  items: NavItem[];
  /** Every lit tab. The reference highlights Chat and the open drawer at once. */
  active: string[];
  onPick: (id: string) => void;
  /** Rows in this machine's audit log, not a balance. */
  entries: number;
  onLedger: () => void;
  ledgerActive: boolean;
}) {
  return (
    <nav className="pillbar" aria-label="Places in your world">
      <div className="pillbar-track">
        {items.map((item) => (
          <button
            key={item.id}
            className={`pill ${active.includes(item.id) ? "on" : ""}`}
            aria-pressed={active.includes(item.id)}
            onClick={() => onPick(item.id)}
            title={item.label}
          >
            <Icon name={MARK[item.id] ?? "box"} size={13} />
            {item.label}
          </button>
        ))}
        <span className="pillbar-sep" aria-hidden />
        <button className={`credits-chip ${ledgerActive ? "on" : ""}`} onClick={onLedger} title="Ledger — what this machine recorded">
          <Icon name="receipt" size={15} />
          <span>Ledger</span>
          <b key={entries}>{entries.toLocaleString("en-US")}</b>
        </button>
      </div>
    </nav>
  );
}
