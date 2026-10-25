import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditEntry, UsageReport } from "../../../shared/types";
import { Icon } from "../shell/icons";
import { ToolBrief } from "../shell/Brief";
import { formatNumber, usePrefs } from "../shell/prefs";
import { Chip, ErrorBlock, LoadingRows } from "../shell/ui";

/**
 * LEDGER — what actually happened here.
 *
 * Every tool call, refusal and finished run appends a row to audit.jsonl; the
 * usage counters are the same records summed. There is no wallet, no pack and no
 * invoice, because there is no payment provider behind this window. When a
 * hosted model is configured, that provider bills the person directly.
 */

type Filter = "all" | "runs" | "tools" | "denied";

export function CreditsScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const [prefs] = usePrefs();
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    try {
      const [audit, report] = await Promise.all([window.viv.audit.list(), window.viv.usage.get()]);
      setRows(audit);
      setUsage(report);
      setError(null);
    } catch {
      setError("Couldn't read the ledger.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const list = rows ?? [];
    return list.filter((row) => {
      if (filter === "runs") return row.kind === "run";
      if (filter === "tools") return row.kind === "tool";
      if (filter === "denied") return row.decision === "denied" || !row.ok;
      return true;
    });
  }, [rows, filter]);

  const runs = usage?.usage.runs ?? 0;
  const toolCalls = usage?.usage.toolCalls ?? 0;

  return (
    <section className="screen" aria-label="Ledger">
      <header className="screen-head">
        <div className="screen-head-main">
          <h1 className="screen-title">Ledger</h1>
          <p className="screen-sub">
            {formatNumber(runs, "en-US")} runs · {formatNumber(toolCalls, "en-US")} tool calls · every action kept on
            this machine
          </p>
        </div>
        <div className="screen-actions">
          <button className="btn sm ghost" onClick={() => onOpen("brain")}>
            <Icon name="brain" size={12} />
            Brain
          </button>
          <button className="btn sm ghost" onClick={() => onOpen("settings")}>
            <Icon name="gear" size={12} />
            Settings
          </button>
        </div>
      </header>

      <div className="screen-body">
        <ToolBrief
          does="Records every tool call, approval, refusal and finished run, in order, with the agent and the exact arguments summary."
          connects="The main process's audit.jsonl and usage.json. Nothing is sent anywhere."
          needs="Nothing. It is written as the work happens; it survives restarts."
          note="This is a local audit log, not billing. There is no balance to run out of."
        />

        <div className="credits-layout">
          <div className="credits-col">
            <div className="credits-hero">
              <div>
                <span className="credits-num">{formatNumber(runs, "en-US")}</span>
                <span className="credits-label">runs on this machine</span>
              </div>
              <div className="credits-hero-side">
                <Chip tone="live" dot>
                  live, local
                </Chip>
                <p className="pane-note">
                  {formatNumber(usage?.usage.estTokens ?? 0, "en-US")} estimated tokens ·{" "}
                  {formatNumber(usage?.memories ?? 0, "en-US")} memories · {formatNumber(usage?.skills ?? 0, "en-US")}{" "}
                  skills
                </p>
              </div>
            </div>

            <div className="credit-usage">
              <div className="credit-usage-row">
                <span>Tool calls {formatNumber(toolCalls, "en-US")}</span>
                <span>Input {formatNumber(usage?.usage.inputChars ?? 0, "en-US")} chars</span>
                <span>Output {formatNumber(usage?.usage.outputChars ?? 0, "en-US")} chars</span>
              </div>
            </div>

            <div className="st-keeps">
              {[
                ["What a row means", "A tool call, a refusal, or a whole run. The run row carries its turns and tool count."],
                ["Where it lives", "audit.jsonl in the data folder. Append-only; export copies it whole."],
                ["What it proves", "That a step happened after the approval you saw, not before it."],
              ].map(([title, line]) => (
                <div key={title} className="st-keep">
                  <b>{title}</b>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="credits-col">
            <div className="filter-strip">
              {(
                [
                  { id: "all", label: "Everything" },
                  { id: "runs", label: "Runs" },
                  { id: "tools", label: "Tools" },
                  { id: "denied", label: "Refused or failed" },
                ] as { id: Filter; label: string }[]
              ).map((f) => (
                <button key={f.id} className={`filter-chip ${filter === f.id ? "on" : ""}`} onClick={() => setFilter(f.id)}>
                  {f.label}
                </button>
              ))}
              <button className="filter-chip" onClick={() => void load()} title="Read the ledger again">
                <Icon name="refresh" size={11} /> Refresh
              </button>
            </div>

            {error ? (
              <ErrorBlock message={error} onRetry={() => void load()} />
            ) : rows === null ? (
              <LoadingRows n={5} label="Reading the ledger" />
            ) : visible.length === 0 ? (
              <div className="empty tight">
                <span className="empty-icon">
                  <Icon name="receipt" size={18} />
                </span>
                <p className="empty-title">Nothing here yet</p>
                <p className="empty-body">Send a message or let her use a tool; the first row appears immediately.</p>
              </div>
            ) : (
              <div className="ledger">
                {visible.slice(0, 120).map((row, i) => (
                  <div key={`${row.at}-${i}`} className="ledger-row">
                    <Icon name={row.kind === "run" ? "spark" : "bolt"} size={13} />
                    <span className="ledger-main">
                      <span>{row.summary || row.tool}</span>
                      <em>
                        {new Date(row.at).toLocaleString(prefs.locale, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {row.agentName ? ` · ${row.agentName}` : ""}
                      </em>
                    </span>
                    <Chip tone={row.ok ? (row.decision === "denied" ? "warn" : "idle") : "bad"}>
                      {row.ok ? row.decision : "failed"}
                    </Chip>
                  </div>
                ))}
              </div>
            )}
            <p className="pane-note">
              Showing {Math.min(visible.length, 120)} of {visible.length} matching entries. Older rows stay in
              audit.jsonl until you export or clear them.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
