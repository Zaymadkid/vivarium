import type { AgentRecord, AuditEntry } from "../../../shared/types";
import { Icon } from "./icons";
import { usePrefs } from "./prefs";
import { useDb } from "./data";
import { Chip, Dot, ProgressRule } from "./ui";
import { AuditPanel, MemoryPanel } from "../Panels";

const STATE_TONE: Record<AgentRecord["state"], "live" | "warn" | "bad" | "idle"> = {
  idle: "idle",
  thinking: "live",
  blocked: "warn",
  error: "bad",
};

const STATE_PROGRESS: Record<AgentRecord["state"], number> = {
  idle: 0.12,
  thinking: 0.62,
  blocked: 0.44,
  error: 0.2,
};

export function Console({
  agents,
  selectedId,
  audit,
  onSelect,
  onTalk,
  onVoice,
  onOpen,
}: {
  agents: AgentRecord[];
  selectedId: string;
  audit: AuditEntry[];
  onSelect: (id: string) => void;
  onTalk: (id: string) => void;
  onVoice: () => void;
  onOpen: (id: string) => void;
}) {
  const [prefs, set] = usePrefs();
  const [db, update] = useDb();
  const agent = agents.find((a) => a.id === selectedId) ?? agents[0];
  const recent = audit.slice(-4).reverse();

  return (
    <div className="console">
      <button className="voice-trigger" onClick={onVoice}>
        <Icon name="mic" size={13} />
        <span>Spacebar for voice</span>
        <kbd className="kbd">Space</kbd>
      </button>

      <section className="cblock">
        <h3>
          <Icon name="bolt" size={13} />
          Activity
          <span className="ccount">{audit.length}</span>
        </h3>
        {recent.length === 0 ? (
          <p className="cempty">No help out right now.</p>
        ) : (
          <ul className="clist">
            {recent.map((row, i) => (
              <li key={`${row.at}-${i}`}>
                <span className="clabel">{row.summary || row.tool}</span>
                <Chip tone={row.ok ? "live" : "bad"}>{row.ok ? "done" : "failed"}</Chip>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="cblock">
        <h3>
          <Icon name="target" size={13} />
          Goals
          <span className="ccount">{db.goals.filter((g) => g.status !== "done").length}</span>
        </h3>
        {db.goals.length === 0 ? (
          <p className="cempty">No goals yet. Say one out loud and she will keep it.</p>
        ) : (
          <ul className="goals">
            {db.goals.map((goal) => {
              const owner = agents.find((a) => a.id === goal.agentId);
              return (
                <li key={goal.id}>
                  <div className="goal-top">
                    <span className="goal-title">{goal.title}</span>
                    <Chip tone={goal.status === "done" ? "live" : goal.status === "working" ? "warm" : "idle"}>
                      {goal.status}
                    </Chip>
                  </div>
                  <ProgressRule
                    value={goal.progress}
                    tone={goal.status === "done" ? "live" : goal.status === "working" ? "warm" : "warm"}
                  />
                  <div className="goal-foot">
                    <span className="goal-owner">{owner ? owner.name : "unassigned"}</span>
                    <span className="goal-actions">
                      <button
                        className="chipbtn"
                        onClick={() => {
                          if (!agent) return;
                          update((prev) => ({
                            ...prev,
                            goals: prev.goals.map((g) =>
                              g.id === goal.id ? { ...g, agentId: agent.id, status: "working" } : g,
                            ),
                          }));
                        }}
                      >
                        Connect
                      </button>
                      <button className="chipbtn" onClick={() => onTalk(goal.agentId || selectedId)}>
                        Talk
                      </button>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="cblock">
        <h3>
          <Icon name="users" size={13} />
          Companions
        </h3>
        <ul className="companions">
          {agents.map((a) => (
            <li key={a.id} className={a.id === selectedId ? "on" : ""}>
              <button className="companion-row" onClick={() => onSelect(a.id)}>
                <Dot tone={STATE_TONE[a.state]} pulse={a.state === "thinking"} />
                <span className="companion-name">{a.name}</span>
                <Chip tone={STATE_TONE[a.state]}>{a.state}</Chip>
              </button>
              <ProgressRule value={STATE_PROGRESS[a.state]} tone={a.state === "error" ? "bad" : a.state === "thinking" ? "live" : "warm"} />
              <div className="companion-foot">
                <button className="chipbtn" onClick={() => onSelect(a.id)}>
                  Connect
                </button>
                <button className="chipbtn" onClick={() => onTalk(a.id)}>
                  Talk
                </button>
                <span className="companion-meta">{Math.round(a.hue)}°</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <details className="cblock">
        <summary>
          <Icon name="brain" size={13} />
          Memory
        </summary>
        <MemoryPanel />
      </details>

      <details className="cblock">
        <summary>
          <Icon name="book" size={13} />
          Ledger
          <span className="ccount">{audit.length}</span>
        </summary>
        <AuditPanel />
      </details>

      <footer className="console-foot">
        <button
          className="mode-line"
          onClick={() => set({ approvalMode: prefs.approvalMode === "auto" ? "manual" : "auto" })}
        >
          <Dot tone={prefs.approvalMode === "auto" ? "live" : "idle"} />
          Actions: {prefs.approvalMode} —{" "}
          {prefs.approvalMode === "auto" ? "companions act on their own" : "companions ask first"}
        </button>
        <button className="footer-link" onClick={() => onOpen("prefs")}>
          All settings
          <Icon name="right" size={12} />
        </button>
      </footer>
    </div>
  );
}
