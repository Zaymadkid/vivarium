import { useState } from "react";
import { Icon } from "../shell/icons";
import { ItemLogo } from "../shell/logo";
import { Tabs } from "../shell/Tabs";
import { Chip, Empty, Screen, SectionLabel } from "../shell/ui";

/**
 * Tools — the reference's two halves (`ToolsView`): Endpoints (HTTP) and Scripts
 * (sandboxed JS/Python). Rows carry a method pill or a language glyph, the URL or
 * the runtime line, and the sandbox note verbatim: "Sandboxed · 30s timeout ·
 * 128MB memory".
 */
type Tab = "endpoints" | "scripts";

interface Endpoint {
  id: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  auth: string;
  uses: number;
}

interface Script {
  id: string;
  name: string;
  lang: "javascript" | "python";
  entry: string;
  uses: number;
}

const ENDPOINTS: Endpoint[] = [
  { id: "ep1", name: "List invoices", method: "GET", url: "https://api.stripe.com/v1/invoices", auth: "Bearer", uses: 12 },
  { id: "ep2", name: "Create ticket", method: "POST", url: "https://api.linear.app/graphql", auth: "Header", uses: 4 },
  { id: "ep3", name: "Fetch calendar", method: "GET", url: "https://www.googleapis.com/calendar/v3", auth: "OAuth", uses: 31 },
];

const SCRIPTS: Script[] = [
  { id: "sc1", name: "Summarise a page", lang: "javascript", entry: "run(input)", uses: 8 },
  { id: "sc2", name: "Clean a CSV", lang: "python", entry: "main(path)", uses: 2 },
];

export function ToolsScreen() {
  const [tab, setTab] = useState<Tab>("endpoints");

  return (
    <Screen
      title="Tools"
      subtitle="What the companions can reach and run."
      actions={
        <Tabs
          label="Tool kinds"
          value={tab}
          onChange={setTab}
          items={[
            { value: "endpoints", label: "Endpoints", count: ENDPOINTS.length },
            { value: "scripts", label: "Scripts", count: SCRIPTS.length },
          ]}
        />
      }
    >
      {tab === "endpoints" ? (
        <>
          <SectionLabel right={<button className="link-btn">+ Endpoint</button>}>HTTP</SectionLabel>
          <div className="tool-list">
            {ENDPOINTS.map((e, i) => (
              <article className="tool-row" key={e.id} style={{ animationDelay: `${i * 40}ms` }}>
                <ItemLogo id={e.name} label={e.name} size={22} glyph="link" />
                <div className="tool-main">
                  <strong>{e.name}</strong>
                  <code>{e.url}</code>
                </div>
                <span className={`method ${e.method.toLowerCase()}`}>{e.method}</span>
                <Chip tone="idle">{e.auth}</Chip>
                <em className="tool-uses">{e.uses} calls</em>
              </article>
            ))}
          </div>
        </>
      ) : (
        <>
          <SectionLabel right={<button className="link-btn">+ Script</button>}>Scripts</SectionLabel>
          <div className="tool-list">
            {SCRIPTS.map((s, i) => (
              <article className="tool-row" key={s.id} style={{ animationDelay: `${i * 40}ms` }}>
                <ItemLogo id={s.lang} label={s.lang} size={22} glyph="cpu" />
                <div className="tool-main">
                  <strong>{s.name}</strong>
                  <code>{s.entry}</code>
                </div>
                <span className={`method ${s.lang === "python" ? "put" : "get"}`}>{s.lang}</span>
                <em className="tool-uses">Sandboxed · 30s timeout · 128MB memory</em>
              </article>
            ))}
          </div>
          <p className="tool-note">
            <Icon name="shield" size={12} /> Scripts run in a sandbox with no network unless you grant it.
          </p>
        </>
      )}

      {ENDPOINTS.length === 0 && tab === "endpoints" && (
        <Empty icon="plug" title="No endpoints yet" body="Add one so she can call your APIs." />
      )}
    </Screen>
  );
}
