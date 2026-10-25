import { useCallback, useEffect, useState } from "react";
import type { IntegrationStatus } from "../../../shared/types";
import { Icon } from "../shell/icons";
import { Chip, Dot, Empty, ErrorBlock, LoadingRows } from "../shell/ui";

/**
 * INTEGRATIONS — measured, not promised.
 *
 * Everything on this screen came back from a probe on this machine: the MCP
 * handshake with BrowserOS neo, Ollama's tag list, a PATH lookup for the CLI
 * agents, the keychain flag for voice, and the settings she actually enforces.
 * There is no Authorize button because there is no OAuth app behind it and no
 * server to exchange a token with; the button that exists goes to the switch
 * that changes the answer.
 */

const CATEGORY_ICON = {
  Browser: "globe",
  Model: "brain",
  Voice: "wave",
  Tools: "bolt",
  Files: "folder",
} as const;

const ACTION_LABEL = {
  settings: "Open Settings",
  mind: "Open Configure",
  voice: "Open Companion",
  folders: "Open Machine access",
} as const;

export function IntegrationsScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const scan = useCallback(async (first = false) => {
    if (!first) setScanning(true);
    setError(null);
    try {
      const next = await window.viv.integrations.scan();
      setRows(next);
      setSelected((current) => current ?? next[0]?.id ?? null);
    } catch (err) {
      setError(
        String(err instanceof Error ? err.message : err).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          "",
        ),
      );
    } finally {
      setLoading(false);
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void scan(true);
  }, [scan]);

  const ready = rows.filter((r) => r.status === "ready");
  const detail = rows.find((r) => r.id === selected) ?? null;

  const open = (row: IntegrationStatus) => {
    if (row.action === "mind") onOpen("configure");
    else if (row.action) onOpen("settings");
  };

  return (
    <section className="screen" aria-label="Integrations">
      <header className="screen-head">
        <div className="screen-head-main">
          <h1 className="screen-title">Integrations</h1>
          <p className="screen-sub">
            {rows.length} measured · {ready.length} ready · probed on this machine only
          </p>
        </div>
        <div className="screen-actions">
          <button className="btn sm" onClick={() => void scan()} disabled={scanning}>
            <Icon name="refresh" size={12} />
            {scanning ? "Probing…" : "Scan again"}
          </button>
        </div>
      </header>

      <div className="screen-body">
        {error && <ErrorBlock message={error} onRetry={() => void scan()} />}

        {loading ? (
          <LoadingRows n={4} label="Probing this machine" />
        ) : rows.length === 0 ? (
          <Empty
            icon="plug"
            title="Nothing answered"
            body="No local service was found. Start BrowserOS neo or Ollama, then scan again."
            action={
              <button className="btn" onClick={() => void scan()}>
                Scan again
              </button>
            }
          />
        ) : (
          <div className="int-layout">
            <div className="int-grid-wrap">
              <div className="int-grid">
                {rows.map((row) => (
                  <button
                    key={row.id}
                    className={`int-card ${selected === row.id ? "on" : ""} st-${row.status}`}
                    onClick={() => setSelected(row.id)}
                  >
                    <span className="int-card-icon">
                      <Icon name={CATEGORY_ICON[row.category]} size={20} />
                    </span>
                    <span className="int-card-main">
                      <b>{row.name}</b>
                      <em>{row.category}</em>
                      <p>{row.detail}</p>
                    </span>
                    {row.status === "ready" ? (
                      <Chip tone="live" dot>
                        ready
                      </Chip>
                    ) : row.status === "offline" ? (
                      <Chip tone="bad">offline</Chip>
                    ) : (
                      <Chip tone="idle">not set up</Chip>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <aside className="int-detail" aria-label="Connection detail">
              {!detail ? (
                <p className="pane-note center">Pick a connection.</p>
              ) : (
                <>
                  <header className="int-detail-head">
                    <span className="int-card-icon lg">
                      <Icon name={CATEGORY_ICON[detail.category]} size={22} />
                    </span>
                    <div>
                      <p>{detail.name}</p>
                      <span>{detail.category}</span>
                    </div>
                    <Dot tone={detail.status === "ready" ? "live" : detail.status === "offline" ? "bad" : "idle"} />
                  </header>

                  <div className="tool-brief inline">
                    <div>
                      <span className="tb-label">What answered</span>
                      <p>{detail.detail}</p>
                    </div>
                    <div>
                      <span className="tb-label">What it needs</span>
                      <p>{detail.needs}</p>
                    </div>
                  </div>

                  <div className="pane-actions">
                    {detail.action && (
                      <button className="btn primary" onClick={() => open(detail)}>
                        {ACTION_LABEL[detail.action]}
                      </button>
                    )}
                    {detail.status === "ready" ? (
                      <span className="pane-note">Ready now. Her tools use it on the next turn.</span>
                    ) : detail.action ? (
                      <span className="pane-note">The switch is in the place this button opens.</span>
                    ) : (
                      <span className="pane-note">Start the service, then scan again.</span>
                    )}
                  </div>

                  <span className="section-label">How this is checked</span>
                  <p className="pane-note">
                    {detail.category === "Browser"
                      ? "A real MCP initialize + tools/list over loopback. The tab list is the browser's own."
                      : detail.category === "Model" && detail.id === "ollama"
                        ? "GET /api/tags on 127.0.0.1:11434. Models listed are the ones the server reports."
                        : detail.category === "Tools" && detail.id === "cli-agents"
                          ? "A PATH lookup for claude, codex, gemini and opencode. Nothing is launched."
                          : detail.category === "Files"
                            ? "The granted folders from settings.json."
                            : "The stored key flag and the abilities she enforces before a tool runs."}
                  </p>
                </>
              )}
            </aside>
          </div>
        )}
      </div>
    </section>
  );
}
