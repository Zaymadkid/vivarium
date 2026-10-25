import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IntegrationStatus, SkillRecord } from "../../../shared/types";
import { Icon } from "../shell/icons";
import { ToolBrief } from "../shell/Brief";
import { Tabs } from "../shell/Tabs";
import { uid, useDb, type Doc } from "../shell/data";
import { pushToast } from "../shell/toasts";
import {
  Chip,
  Confirm,
  Dot,
  Empty,
  ErrorBlock,
  Field,
  LoadingRows,
  TextArea,
  TextInput,
} from "../shell/ui";

type Filter = "all" | "yours" | "drafts";

interface Draft {
  id: string | null;
  name: string;
  description: string;
  docs: string[];
  integrations: string[];
  instructions: string;
}

const EMPTY_DRAFT: Draft = {
  id: null,
  name: "",
  description: "",
  docs: [],
  integrations: [],
  instructions: "",
};

export function SkillsScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const [db, update] = useDb();
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [connections, setConnections] = useState<IntegrationStatus[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [tab, setTab] = useState<"docs" | "integrations" | "instructions">("docs");
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    try {
      const [list, ints] = await Promise.all([
        window.viv.skills.list(),
        window.viv.integrations.scan().catch(() => [] as IntegrationStatus[]),
      ]);
      setSkills(list);
      setConnections(ints.filter((i) => i.status === "ready"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter((s) => {
      if (filter === "yours" && !s.description) return false;
      if (filter === "drafts" && s.description) return false;
      return !q || `${s.name} ${s.description}`.toLowerCase().includes(q);
    });
  }, [skills, filter, query]);

  const editing = draft.id ? skills.find((s) => s.id === draft.id) : null;

  const startCreate = () => {
    setDraft(EMPTY_DRAFT);
    setNameError(null);
    setTab("docs");
  };

  const startEdit = (skill: SkillRecord) => {
    setDraft({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      docs: skill.docs,
      integrations: skill.integrations,
      instructions: skill.instructions,
    });
    setNameError(null);
    setError(null);
  };

  const addFiles = (files: FileList | File[]) => {
    const picked = Array.from(files);
    const good = picked.filter((f) => /\.(md|txt)$/i.test(f.name));
    const bad = picked.filter((f) => !/\.(md|txt)$/i.test(f.name));
    if (good.length === 0) {
      setError(`Failed to add documents: ${picked.map((f) => f.name).join(", ")} — only .md and .txt.`);
      return;
    }
    let pending = good.length;
    const created: Doc[] = [];
    good.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        created.push({
          id: uid(),
          title: file.name.replace(/\.(md|txt)$/i, ""),
          body: String(reader.result ?? ""),
          tags: ["skill"],
          folderId: null,
          updatedAt: Date.now(),
        });
        pending--;
        if (pending === 0) {
          update((prev) => ({ ...prev, docs: [...created, ...prev.docs] }));
          setDraft((d) => ({ ...d, docs: [...d.docs, ...created.map((c) => c.id)] }));
          if (bad.length) {
            setError(`Failed to add documents: ${bad.map((f) => f.name).join(", ")}.`);
          } else {
            setError(null);
            pushToast({ title: `${created.length} document${created.length === 1 ? "" : "s"} added`, tone: "ok" });
          }
        }
      };
      reader.onerror = () => {
        pending--;
        setError(`Failed to add documents: ${file.name} could not be read.`);
      };
      reader.readAsText(file);
    });
  };

  const save = async () => {
    if (!draft.name.trim()) {
      setNameError("Name is required");
      return;
    }
    setNameError(null);
    setBusy(true);
    try {
      const saved = await window.viv.skills.save({
        id: draft.id ?? undefined,
        name: draft.name.trim(),
        description: draft.description.trim(),
        docs: draft.docs,
        integrations: draft.integrations,
        instructions: draft.instructions,
        source: editing?.source ?? "manual",
      });
      setSkills(saved);
      const match = saved.find((s) => s.name.toLowerCase() === draft.name.trim().toLowerCase());
      setDraft((d) => ({ ...d, id: match?.id ?? d.id }));
      pushToast({
        title: draft.id ? "Skill saved" : "Skill created",
        body: `${draft.name.trim()} — she follows it from the next turn on.`,
        tone: "ok",
      });
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: "docs" | "integrations", value: string) =>
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(value) ? d[key].filter((x) => x !== value) : [...d[key], value],
    }));

  const connected = connections;

  return (
    <section className="screen" aria-label="Skills">
      <header className="screen-head">
        <div className="screen-head-main">
          <h1 className="screen-title">Skills</h1>
          <p className="screen-sub">
            {skills.length} skills · stored on this machine and read by her on every turn
          </p>
        </div>
        <div className="screen-actions">
          <span className="search-inline">
            <Icon name="search" size={13} />
            <input
              value={query}
              placeholder="Search skills"
              aria-label="Search skills"
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
          <button className="btn sm primary" onClick={startCreate}>
            <Icon name="plus" size={12} />
            New Skill
          </button>
        </div>
      </header>

      <div className="screen-body">
        <ToolBrief
          does="Bundles the documents, integrations and standing instructions one job needs, so a companion can pick it up by name."
          connects="Your local documents and any integration you have already connected."
          needs="A name, one sentence of description, and at least one instruction. Documents optional."
          note={
            "Saved skills are inserted into her instructions on the next turn. Learned skills appear here too, with the steps that worked."
          }
        />

        <div className="skills-layout">
          <div className="skills-list">
            <div className="filter-strip">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "yours", label: "Ready" },
                  { id: "drafts", label: "Drafts" },
                ] as { id: Filter; label: string }[]
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

            {error && <ErrorBlock message={error} onRetry={() => setError(null)} />}

            {loading ? (
              <LoadingRows n={3} label="Loading skills" />
            ) : skills.length === 0 ? (
              <Empty
                icon="skill"
                title="No skills yet"
                body="A skill is a document, an integration and a standing instruction in one place."
                action={
                  <button className="btn primary" onClick={startCreate}>
                    Create the first one
                  </button>
                }
              />
            ) : visible.length === 0 ? (
              <Empty tight icon="search" title="Nothing matches that." body="Try a shorter search or another filter." />
            ) : (
              <div className="skill-cards">
                {visible.map((skill) => (
                  <button
                    key={skill.id}
                    className={`skill-card ${draft.id === skill.id ? "on" : ""}`}
                    onClick={() => startEdit(skill)}
                  >
                    <header>
                      <Dot tone={skill.description ? "live" : "warn"} />
                      <span className="skill-name">{skill.name}</span>
                      <Chip tone={skill.description ? "live" : "warn"}>
                        {skill.source === "learned" ? "learned" : skill.description ? "ready" : "draft"}
                      </Chip>
                    </header>
                    <p>{skill.description || "No description yet."}</p>
                    <footer>
                      <span>
                        <Icon name="doc" size={11} /> {skill.docs.length} docs
                      </span>
                      <span>
                        <Icon name="plug" size={11} /> {skill.integrations.length} linked
                      </span>
                      <span className="skill-date">
                        {skill.source === "learned" ? `learned · ${skill.uses} use${skill.uses === 1 ? "" : "s"}` : "yours"}
                      </span>
                    </footer>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="skills-editor">
            {draft.id === null && !draft.name ? (
              <div className="editor-idle">
                <Empty
                  tight
                  icon="skill"
                  title={editing ? editing.name : "Pick a skill, or start one"}
                  body="Name it, describe it in a sentence, then attach what it needs."
                  action={
                    <button className="btn" onClick={startCreate}>
                      New Skill
                    </button>
                  }
                />
              </div>
            ) : (
              <>
                <header className="editor-head">
                  <span>{draft.id ? "Edit skill" : "New skill"}</span>
                  {draft.id && (
                    <button
                      className="btn sm ghost danger"                          onClick={() => setConfirmDelete(draft.id)}
                        >
                          Delete
                    </button>
                  )}
                </header>

                <Field label="Name" error={nameError} hint="e.g. Social Media Manager">
                  <TextInput
                    value={draft.name}
                    onChange={(v) => {
                      setDraft({ ...draft, name: v });
                      if (v.trim()) setNameError(null);
                    }}
                    placeholder="e.g. Social Media Manager"
                    autoFocus={!draft.id}
                  />
                </Field>

                <Field label="Description" hint="Brief description of what this skill does">
                  <TextArea
                    value={draft.description}
                    onChange={(v) => setDraft({ ...draft, description: v })}
                    rows={2}
                    placeholder="Brief description of what this skill does"
                  />
                </Field>

                <Tabs
                  label="Skill sections"
                  value={tab}
                  onChange={setTab}
                  align="stretch"
                  items={[
                    { value: "docs", label: "Documents", count: draft.docs.length },
                    { value: "integrations", label: "Integrations", count: draft.integrations.length },
                    { value: "instructions", label: "Instructions" },
                  ]}
                />

                {tab === "docs" && (
                  <div className="editor-pane">
                    <div
                      className={`dropzone ${dragging ? "over" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragging(false);
                        addFiles(e.dataTransfer.files);
                      }}
                      onClick={() => fileInput.current?.click()}
                    >
                      <Icon name="doc" size={16} />
                      <p>Drop .md or .txt files here</p>
                      <span>or click to pick them</span>
                      <input
                        ref={fileInput}
                        type="file"
                        multiple
                        accept=".md,.txt"
                        hidden
                        onChange={(e) => {
                          if (e.target.files) addFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </div>

                    <span className="section-label">Skill Documents</span>
                    {draft.docs.length === 0 && db.docs.length === 0 ? (
                      <div className="list-empty">No documents yet.</div>
                    ) : (
                      <div className="pick-list">
                        {db.docs.slice(0, 8).map((doc) => (
                          <label key={doc.id} className="pick-row">
                            <input
                              type="checkbox"
                              checked={draft.docs.includes(doc.id)}
                              onChange={() => toggle("docs", doc.id)}
                            />
                            <Icon name="doc" size={12} />
                            <span>{doc.title}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {tab === "integrations" && (
                  <div className="editor-pane">
                    {connected.length === 0 ? (
                      <div className="list-empty">
                        Nothing connected yet.{" "}
                        <button className="inline-link" onClick={() => onOpen("integrations")}>
                          Open Integrations
                        </button>
                      </div>
                    ) : (
                      <div className="pick-list">
                        {connected.map((i) => (
                          <label key={i.id} className="pick-row">
                            <input
                              type="checkbox"
                              checked={draft.integrations.includes(i.id)}
                              onChange={() => toggle("integrations", i.id)}
                            />
                            <span className="provider-mark sm">{i.name.slice(0, 1)}</span>
                            <span>{i.name}</span>
                            <Chip tone="live">connected</Chip>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {tab === "instructions" && (
                  <div className="editor-pane">
                    <Field label="Standing instructions" hint="What the skill should always do, and never do.">
                      <TextArea
                        value={draft.instructions}
                        onChange={(v) => setDraft({ ...draft, instructions: v })}
                        rows={6}
                        mono
                        placeholder="Read every unread thread. Draft replies under 90 words. Never send without asking."
                      />
                    </Field>
                  </div>
                )}

                <footer className="editor-foot">
                  <span className="pane-note">
                    {draft.docs.length} docs · {draft.integrations.length} integrations
                  </span>
                  <button className="btn primary" onClick={save} disabled={busy}>
                    {busy ? "Creating..." : draft.id ? "Save skill" : "Create Skill"}
                  </button>
                </footer>
              </>
            )}
          </div>
        </div>
      </div>

      {confirmDelete && (
        <Confirm
          title="Delete this skill?"
          body={<p>The documents stay; only the bundle goes.</p>}
          confirmLabel="Delete"
          danger
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            void window.viv.skills.remove(confirmDelete).then((rows) => {
              setSkills(rows);
              setDraft(EMPTY_DRAFT);
              setConfirmDelete(null);
              pushToast({ title: "Skill deleted", tone: "info" });
            });
          }}
        />
      )}
    </section>
  );
}
