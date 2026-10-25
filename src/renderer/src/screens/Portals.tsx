import { useEffect, useState } from "react";
import { Icon } from "../shell/icons";
import { ToolBrief } from "../shell/Brief";
import { formatDate, usePrefs } from "../shell/prefs";
import { uid, useDb, type Portal } from "../shell/data";
import { pushToast } from "../shell/toasts";
import { Tabs } from "../shell/Tabs";
import {
  Chip,
  Confirm,
  Dot,
  Empty,
  ErrorBlock,
  Field,
  LoadingRows,
  Modal,
  ProgressRule,
  TextInput,
  Toggle,
} from "../shell/ui";

type Tab = "shared" | "received" | "audit";

export function PortalsScreen() {
  const [db, update] = useDb();
  const [prefs] = usePrefs();
  const [selected, setSelected] = useState<string | null>(db.portals[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>("shared");
  const [creating, setCreating] = useState(false);
  const [partner, setPartner] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = window.setTimeout(() => setLoading(false), 180);
    return () => window.clearTimeout(id);
  }, []);

  const portal = db.portals.find((p) => p.id === selected) ?? null;

  const patch = (id: string, next: Partial<Portal>) =>
    update((prev) => ({
      ...prev,
      portals: prev.portals.map((p) => (p.id === id ? { ...p, ...next } : p)),
    }));

  const toggleShare = (folderId: string, on: boolean) => {
    if (!portal) return;
    patch(portal.id, {
      status: "saving",
      shared: portal.shared.map((f) => (f.id === folderId ? { ...f, on } : f)),
    });
    window.setTimeout(() => {
      update((prev) => ({
        ...prev,
        portals: prev.portals.map((p) =>
          p.id === portal.id
            ? {
                ...p,
                status: "synced",
                audit: [
                  {
                    id: uid(),
                    at: Date.now(),
                    who: "You",
                    what: `${on ? "shared" : "unshared"} ${p.shared.find((f) => f.id === folderId)?.name ?? "a folder"}`,
                  },
                  ...p.audit,
                ],
              }
            : p,
        ),
      }));
      pushToast({ title: "Saved", body: on ? "Folder shared" : "Folder unshared", tone: "ok" });
    }, 900);
  };

  const create = () => {
    if (!email.trim()) {
      setEmailError("An email is required");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError("That doesn't look like an email");
      return;
    }
    const next: Portal = {
      id: uid(),
      partner: partner.trim() || email.split("@")[0],
      email: email.trim(),
      status: "synced",
      shared: db.folders.map((f) => ({
        id: uid(),
        name: f.name,
        rail: "#35E29B",
        count: db.docs.filter((d) => d.folderId === f.id).length,
        on: false,
      })),
      received: [],
      audit: [{ id: uid(), at: Date.now(), who: "You", what: "created this portal" }],
    };
    update((prev) => ({ ...prev, portals: [next, ...prev.portals] }));
    setSelected(next.id);
    setCreating(false);
    setPartner("");
    setEmail("");
    pushToast({ title: "Portal created", body: `${next.partner} can be invited.`, tone: "ok" });
  };

  return (
    <section className="screen" aria-label="Portals">
      <header className="screen-head">
        <div className="screen-head-main">
          <h1 className="screen-title">Portals</h1>
          <p className="screen-sub">
            {db.portals.length} partners · {" "}
            {db.portals.reduce((n, p) => n + p.shared.filter((f) => f.on).length, 0)} folders shared ·{" "}
            {db.portals.reduce((n, p) => n + p.received.length, 0)} received
          </p>
        </div>
        <div className="screen-actions">
          <button className="btn sm primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={12} />
            New portal
          </button>
        </div>
      </header>

      <div className="screen-body">
        <ToolBrief
          does="Shares chosen folders with one other person, and shows you exactly what they opened."
          connects="A partner's email, a folder list, and an append-only audit trail."
          needs="A partner email and at least one folder. Nothing is uploaded — the folder stays yours."
          note="Where this build stops: there is no relay, so a portal records what would be shared and never syncs it off the machine."
        />

        {error && <ErrorBlock message={error} onRetry={() => setError(null)} />}

        <div className="portal-layout">
          <div className="portal-list">
            {loading ? (
              <LoadingRows n={2} label="Loading portals" />
            ) : db.portals.length === 0 ? (
              <Empty
                icon="users"
                title="No portals yet"
                body="A portal is one person, a handful of folders, and a record of what they saw."
                action={
                  <button className="btn primary" onClick={() => setCreating(true)}>
                    Create the first portal
                  </button>
                }
              />
            ) : (
              db.portals.map((p) => {
                const sharing = p.shared.filter((f) => f.on).length;
                return (
                  <button
                    key={p.id}
                    className={`portal-card ${selected === p.id ? "on" : ""}`}
                    onClick={() => setSelected(p.id)}
                  >
                    <span className="msg-avatar lg ch-email">{p.partner.slice(0, 1)}</span>
                    <span className="portal-main">
                      <b>{p.partner}</b>
                      <em>{p.email}</em>
                      <span className="portal-meta">
                        <Chip tone="idle">{sharing} shared</Chip>
                        <Chip tone="idle">{p.received.length} received</Chip>
                        <span className="portal-sync">
                          <Dot tone={p.status === "synced" ? "live" : p.status === "error" ? "bad" : "warn"} />
                          {p.status === "synced" ? "Synced" : p.status === "saving" ? "Saving…" : "Sync failed"}
                        </span>
                      </span>
                    </span>
                    <Icon name="right" size={13} />
                  </button>
                );
              })
            )}
            <p className="pane-note">
              Invites are copied by hand. This build sends no mail.
            </p>
          </div>

          <div className="portal-detail">
            {!portal ? (
              <Empty
                tight
                icon="users"
                title={db.portals.length === 0 ? "No partner selected" : "Portal not found"}
                body="Pick a partner on the left, or make a new portal."
              />
            ) : (
              <>
                <header className="portal-head">
                  <span className="msg-avatar lg ch-email">{portal.partner.slice(0, 1)}</span>
                  <div>
                    <p>{portal.partner}</p>
                    <span>{portal.email}</span>
                  </div>
                  <Chip tone={portal.status === "synced" ? "live" : portal.status === "error" ? "bad" : "warn"} dot>
                    {portal.status}
                  </Chip>
                  <button className="icon-btn sm" aria-label="Delete portal" onClick={() => setConfirmDelete(portal.id)}>
                    <Icon name="trash" size={13} />
                  </button>
                </header>

                <div className="portal-rail">
                  <Tabs
                    label="Portal views"
                    value={tab}
                    onChange={setTab}
                    items={[
                      { value: "shared", label: "What I'm Sharing" },
                      { value: "received", label: "What They're Sharing" },
                      { value: "audit", label: "Audit" },
                    ]}
                  />
                </div>

                {tab === "shared" && (
                  <div className="portal-pane">
                    {portal.shared.length === 0 ? (
                      <div className="list-empty">No folders yet. Add one to share something.</div>
                    ) : (
                      portal.shared.map((f) => (
                        <div key={f.id} className="share-row">
                          <span className="rail" style={{ background: f.rail }} />
                          <Icon name="folder" size={14} />
                          <span className="share-main">
                            <b>{f.name}</b>
                            <em>{f.count} documents</em>
                          </span>
                          <Toggle
                            on={f.on}
                            onChange={(v) => toggleShare(f.id, v)}
                            label={`Share ${f.name}`}
                            disabled={portal.status === "saving"}
                          />
                        </div>
                      ))
                    )}
                    <div className="share-foot">
                      <span className="pane-note">
                        {portal.shared.filter((f) => f.on).length} of {portal.shared.length} shared
                      </span>
                      <ProgressRule
                        value={
                          portal.shared.length === 0
                            ? 0
                            : portal.shared.filter((f) => f.on).length / portal.shared.length
                        }
                      />
                      <button
                        className="btn sm"
                        onClick={() => {
                          patch(portal.id, { status: "saving" });
                          window.setTimeout(() => {
                            patch(portal.id, {
                              status: "synced",
                              audit: [
                                { id: uid(), at: Date.now(), who: "You", what: "saved sharing settings" },
                                ...portal.audit,
                              ],
                            });
                            pushToast({ title: "Synced", body: "Nothing left this machine." , tone: "ok" });
                          }, 800);
                        }}
                        disabled={portal.status === "saving"}
                      >
                        {portal.status === "saving" ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                )}

                {tab === "received" && (
                  <div className="portal-pane">
                    {portal.received.length === 0 ? (
                      <div className="list-empty">
                        Nothing shared with you yet. Ask {portal.partner.split(" ")[0]} for a folder.
                      </div>
                    ) : (
                      portal.received.map((f) => (
                        <div key={f.id} className="share-row">
                          <span className="rail" style={{ background: f.rail }} />
                          <Icon name="folder" size={14} />
                          <span className="share-main">
                            <b>{f.name}</b>
                            <em>{f.count} files · read-only</em>
                          </span>
                          <Chip tone="idle">received</Chip>
                        </div>
                      ))
                    )}
                    <p className="pane-note">
                      Files stay in their folder. Nothing is copied into yours until you ask.
                    </p>
                  </div>
                )}

                {tab === "audit" && (
                  <div className="portal-pane">
                    {portal.audit.length === 0 ? (
                      <div className="list-empty">No activity from {portal.partner} yet.</div>
                    ) : (
                      <ul className="audit-list">
                        {portal.audit.map((a) => (
                          <li key={a.id}>
                            <Dot tone={a.who === "You" ? "live" : "warm"} />
                            <span>{a.what}</span>
                            <em>
                              {a.who} · {formatDate(a.at, prefs.locale)}
                            </em>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {creating && (
        <Modal
          title="New portal"
          onClose={() => setCreating(false)}
          width={420}
          footer={
            <>
              <button className="btn ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={create}>
                Create portal
              </button>
            </>
          }
        >
          <Field label="Who is it for">
            <TextInput value={partner} onChange={setPartner} placeholder="Mira Okafor" autoFocus />
          </Field>
          <Field label="Their email" error={emailError} hint="Only used to label the portal here.">
            <TextInput
              value={email}
              onChange={(v) => {
                setEmail(v);
                if (emailError) setEmailError(null);
              }}
              type="email"
              placeholder="mira@example.studio"
            />
          </Field>
          <p className="pane-note">
            New portals start with every folder switched off. Turn on what you want to share after it is
            created.
          </p>
        </Modal>
      )}

      {confirmDelete && (
        <Confirm
          title="Delete this portal?"
          body={<p>The partner loses access immediately. The audit trail is kept.</p>}
          confirmLabel="Delete"
          danger
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            update((prev) => ({ ...prev, portals: prev.portals.filter((p) => p.id !== confirmDelete) }));
            setSelected(null);
            pushToast({ title: "Portal deleted", tone: "info" });
          }}
        />
      )}
    </section>
  );
}
