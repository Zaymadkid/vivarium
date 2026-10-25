import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContextPack, VaultDocument, VaultHit } from "../../../shared/types";
import { Icon } from "../shell/icons";
import { ToolBrief } from "../shell/Brief";
import { Tabs } from "../shell/Tabs";
import { Markdown } from "../shell/Markdown";
import { formatDate, nowStamp, usePrefs } from "../shell/prefs";
import { uid, useDb, type CanvasNode, type Doc } from "../shell/data";
import { pushToast } from "../shell/toasts";
import {
  Chip,
  Confirm,
  Dot,
  Empty,
  ErrorBlock,
  Field,
  LoadingRows,
  Menu,
  MenuRow,
  TextInput,
} from "../shell/ui";

type Tab = "entries" | "canvas" | "vault" | "packs";

export function DocumentsScreen({ onTalk }: { onTalk: () => void }) {
  const [db, update] = useDb();
  const [prefs] = usePrefs();
  const [tab, setTab] = useState<Tab>("entries");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(db.docs[0]?.id ?? null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = window.setTimeout(() => setLoading(false), 160);
    return () => window.clearTimeout(id);
  }, []);

  const docs = useMemo(() => {
    const list = query.trim()
      ? db.docs.filter((d) => `${d.title} ${d.body} ${d.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()))
      : db.docs;
    return prefs.sortOrder === "alpha" ? [...list].sort((a, b) => a.title.localeCompare(b.title)) : list;
  }, [db.docs, query, prefs.sortOrder]);

  const selected = db.docs.find((d) => d.id === selectedId) ?? null;

  const createDoc = () => {
    const folder = db.folders.find((f) => f.name === prefs.defaultFolder);
    const doc: Doc = {
      id: uid(),
      title: "Untitled",
      body: "",
      tags: [],
      folderId: folder?.id ?? null,
      updatedAt: Date.now(),
    };
    update((prev) => ({ ...prev, docs: [doc, ...prev.docs] }));
    setSelectedId(doc.id);
    setTab("entries");
    setRenameId(doc.id);
    setRenameValue("");
  };

  const createFolder = () => {
    const name = `Folder ${db.folders.length + 1}`;
    update((prev) => ({ ...prev, folders: [...prev.folders, { id: uid(), name }] }));
    pushToast({ title: "Folder created", body: name, tone: "ok" });
  };

  const patchDoc = (id: string, patch: Partial<Doc>) =>
    update((prev) => ({
      ...prev,
      docs: prev.docs.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d)),
    }));

  const download = (doc: Doc) => {
    try {
      const blob = new Blob([`# ${doc.title}\n\n${doc.body}`], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.title.replace(/[^\w\s-]/g, "").trim() || "untitled"}.md`;
      a.click();
      URL.revokeObjectURL(url);
      pushToast({ title: "Exported", body: `${doc.title}.md`, tone: "ok" });
    } catch {
      pushToast({ title: "Export failed:", body: "The download was blocked.", tone: "bad" });
    }
  };

  const tree = (
    <aside className="doc-side" aria-label="Knowledge">
      <header className="doc-side-head">
        <span className="doc-side-title">Knowledge</span>
        <span className="doc-side-actions">
          <button className="icon-btn xs" onClick={createDoc} title="New document" aria-label="New document">
            <Icon name="doc" size={13} />
          </button>
          <button className="icon-btn xs" onClick={createFolder} title="New folder" aria-label="New folder">
            <Icon name="folder" size={13} />
          </button>
        </span>
      </header>
      <div className="doc-search">
        <Icon name="search" size={12} />
        <input
          value={query}
          placeholder="Search entries and files..."
          aria-label="Search entries and files"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="doc-tree">
        {loading ? (
          <LoadingRows n={4} />
        ) : db.docs.length === 0 ? (
          <Empty
            tight
            icon="doc"
            title="No entries yet"
            body="Write one, or drop a markdown file in."
            action={
              <button className="btn sm primary" onClick={createDoc}>
                New document
              </button>
            }
          />
        ) : docs.length === 0 ? (
          <div className="tree-none">No entries match “{query}”.</div>
        ) : (
          <>
            {db.folders.map((folder) => {
              const items = docs.filter((d) => d.folderId === folder.id);
              return (
                <div key={folder.id} className="tree-group">
                  <div className="tree-folder">
                    <Icon name="down" size={10} />
                    <span>{folder.name}</span>
                    <b>{items.length}</b>
                  </div>
                  {items.map(renderRow)}
                </div>
              );
            })}
            <div className="tree-group">
              <div className="tree-folder">
                <Icon name="down" size={10} />
                <span>Unfiled</span>
                <b>{docs.filter((d) => !d.folderId).length}</b>
              </div>
              {docs.filter((d) => !d.folderId).map(renderRow)}
            </div>
          </>
        )}
      </div>
      <footer className="doc-side-foot">
        <button className="btn ghost sm" onClick={onTalk}>
          <Icon name="spark" size={12} />
          Ask her to write one
        </button>
      </footer>
    </aside>
  );

  function renderRow(doc: Doc) {
    const active = doc.id === selectedId;
    return (
      <div key={doc.id} className={`tree-row ${active ? "on" : ""}`}>
        {renameId === doc.id ? (
          <input
            className="tree-rename"
            autoFocus
            value={renameValue}
            placeholder={doc.title}
            aria-label="Rename document"
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => {
              if (renameValue.trim()) patchDoc(doc.id, { title: renameValue.trim() });
              setRenameId(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (!renameValue.trim()) {
                  setError("Couldn't rename that entry. A title is required.");
                } else {
                  patchDoc(doc.id, { title: renameValue.trim() });
                  setError(null);
                }
                setRenameId(null);
              }
              if (e.key === "Escape") setRenameId(null);
            }}
          />
        ) : (
          <>
            <button
              className="tree-label"
              onClick={() => {
                setSelectedId(doc.id);
                setTab("entries");
              }}
              onDoubleClick={() => {
                setRenameId(doc.id);
                setRenameValue(doc.title);
              }}
            >
              <Icon name="doc" size={12} />
              <span>{doc.title}</span>
            </button>
            <span className="menu-anchor">
              <button
                className="icon-btn xs tree-more"
                aria-label={`More for ${doc.title}`}
                onClick={() => setMenuFor(menuFor === doc.id ? null : doc.id)}
              >
                <Icon name="drag" size={12} />
              </button>
              {menuFor === doc.id && (
                <Menu onClose={() => setMenuFor(null)} width={210}>
                  <MenuRow
                    icon="doc"
                    onClick={() => {
                      setRenameId(doc.id);
                      setRenameValue(doc.title);
                      setMenuFor(null);
                    }}
                  >
                    Rename
                  </MenuRow>
                  <MenuRow icon="folder" onClick={() => setMoving(doc.id)}>
                    Move to folder
                  </MenuRow>
                  <MenuRow
                    icon="external"
                    onClick={() => {
                      download(doc);
                      setMenuFor(null);
                    }}
                  >
                    Download as .md
                  </MenuRow>
                  <div className="menu-rule" />
                  <MenuRow
                    icon="trash"
                    danger
                    onClick={() => {
                      setConfirmDelete(doc.id);
                      setMenuFor(null);
                    }}
                  >
                    Delete
                  </MenuRow>
                </Menu>
              )}
            </span>
          </>
        )}
        {moving === doc.id && (
          <Menu
            onClose={() => setMoving(null)}
            width={200}
            className="nested-menu"
          >
            {db.folders.map((f) => (
              <MenuRow
                key={f.id}
                active={doc.folderId === f.id}
                onClick={() => {
                  patchDoc(doc.id, { folderId: f.id });
                  setMoving(null);
                }}
              >
                {f.name}
              </MenuRow>
            ))}
            <MenuRow
              active={!doc.folderId}
              onClick={() => {
                patchDoc(doc.id, { folderId: null });
                setMoving(null);
              }}
            >
              Unfiled
            </MenuRow>
          </Menu>
        )}
      </div>
    );
  }

  return (
    <section className="screen flush" aria-label="Documents">
      <header className="screen-head">
        <div className="screen-head-main">
          <h1 className="screen-title">Documents</h1>
          <p className="screen-sub">
            {db.docs.length} entries · {db.folders.length} folders · plain markdown on this machine
          </p>
        </div>
        <div className="screen-actions">
          <Tabs
            label="Document views"
            value={tab}
            onChange={setTab}
            items={[
              { value: "entries", label: "Entries", count: db.docs.length },
              { value: "canvas", label: "Canvas" },
              { value: "vault", label: "Vault" },
              { value: "packs", label: "Packs" },
            ]}
          />
          <button className="btn sm primary" onClick={createDoc}>
            <Icon name="plus" size={12} />
            New document
          </button>
        </div>
      </header>

      {error && (
        <div className="screen-alert">
          <ErrorBlock message={error} onRetry={() => setError(null)} />
        </div>
      )}

      <div className="doc-brief">
        <ToolBrief
          does="Holds the markdown you write and the files you drop, in folders you control."
          connects="The chat drawer for attachments, skills for context, and the local disk for export."
          needs="Plain text. Nothing is uploaded; export writes one .md file per entry to your downloads."
          note="Where this build stops: there is no sync or cloud copy, so these entries live only on this machine."
        />
      </div>

      <div className="doc-layout">
        {tree}
        <div className="doc-main">
          {tab === "entries" &&
            (selected ? (
              <EntryView
                key={selected.id}
                doc={selected}
                folders={db.folders}
                onPatch={(p) => patchDoc(selected.id, p)}
                onClose={() => setSelectedId(null)}
                onDownload={() => download(selected)}
                onDelete={() => setConfirmDelete(selected.id)}
                onError={setError}
              />
            ) : (
              <Empty
                icon="doc"
                title="Nothing open"
                body="Pick an entry on the left, or start a new one. Double-click a title to rename it."
                action={
                  <button className="btn primary" onClick={createDoc}>
                    New document
                  </button>
                }
              />
            ))}
          {tab === "canvas" && <CanvasTab />}
          {tab === "vault" && <VaultTab />}
          {tab === "packs" && <PacksTab />}
        </div>
      </div>

      {confirmDelete && (
        <Confirm
          title="Delete this entry?"
          body={
            <>
              <p>
                <b>{db.docs.find((d) => d.id === confirmDelete)?.title}</b> will be removed from this
                machine. There is no cloud copy.
              </p>
            </>
          }
          confirmLabel="Delete"
          danger
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            update((prev) => ({ ...prev, docs: prev.docs.filter((d) => d.id !== confirmDelete) }));
            if (selectedId === confirmDelete) setSelectedId(null);
            pushToast({ title: "Entry deleted", tone: "info" });
          }}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ entry */

function EntryView({
  doc,
  folders,
  onPatch,
  onClose,
  onDownload,
  onDelete,
  onError,
}: {
  doc: Doc;
  folders: { id: string; name: string }[];
  onPatch: (patch: Partial<Doc>) => void;
  onClose: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onError: (msg: string | null) => void;
}) {
  const [prefs] = usePrefs();
  const [source, setSource] = useState(false);
  const [draft, setDraft] = useState(doc.body);
  const [title, setTitle] = useState(doc.title);
  const [dirty, setDirty] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [savedAt, setSavedAt] = useState(Date.now());
  const timer = useRef(0);

  useEffect(() => {
    setDraft(doc.body);
    setTitle(doc.title);
    setDirty(false);
  }, [doc.id]);

  useEffect(() => {
    if (!dirty) return;
    if (!prefs.autosave) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      onPatch({ body: draft, title: title.trim() || "Untitled" });
      setDirty(false);
      setSavedAt(Date.now());
    }, 600);
    return () => window.clearTimeout(timer.current);
  }, [draft, title, dirty, prefs.autosave, onPatch]);

  const folder = folders.find((f) => f.id === doc.folderId);

  return (
    <div className="entry">
      <header className="entry-head">
        <div className="entry-title-row">
          <span className="entry-prefix">Document:</span>
          <input
            className="entry-title"
            value={title}
            aria-label="Document title"
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            onBlur={() => {
              if (!title.trim()) {
                setTitle("Untitled");
                onError("A title is required — kept Untitled.");
              }
            }}
          />
          <span className={`save-dot ${dirty ? "dirty" : ""}`} title={dirty ? "Unsaved" : "Saved"} />
          <span className="entry-state">
            {dirty ? (prefs.autosave ? "Saving…" : "Unsaved") : `Saved · ${nowStamp()}`}
          </span>
        </div>
        <div className="entry-actions">
          <button
            className={`icon-btn sm ${source ? "on" : ""}`}
            title="Edit source"
            aria-label="Edit source"
            onClick={() => setSource((v) => !v)}
          >
            <Icon name="file" size={13} />
          </button>
          <button className="icon-btn sm" title="Download as .md" aria-label="Download as .md" onClick={onDownload}>
            <Icon name="arrowUp" size={13} style={{ transform: "rotate(180deg)" }} />
          </button>
          <button className="icon-btn sm" title="Close document" aria-label="Close document" onClick={onClose}>
            <Icon name="close" size={13} />
          </button>
          <button className="icon-btn sm danger" title="Delete" aria-label="Delete" onClick={onDelete}>
            <Icon name="trash" size={13} />
          </button>
        </div>
      </header>

      <div className="entry-meta">
        <span className="entry-folder">
          <Icon name="folder" size={11} />
          {folder?.name ?? "Unfiled"}
        </span>
        <div className="entry-tags">
          {doc.tags.map((t) => (
            <span key={t} className="chip tag">
              #{t}
              <button
                className="chip-x"
                aria-label={`Remove tag ${t}`}
                onClick={() => {
                  try {
                    onPatch({ tags: doc.tags.filter((x) => x !== t) });
                  } catch {
                    onError("Failed to update tags: nothing was written.");
                  }
                }}
              >
                ×
              </button>
            </span>
          ))}
          <span className="tag-add">
            <input
              value={tagDraft}
              placeholder="+ tag"
              aria-label="Add tag"
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tagDraft.trim()) {
                  onPatch({ tags: [...new Set([...doc.tags, tagDraft.trim().replace(/^#/, "")])] });
                  setTagDraft("");
                }
              }}
            />
          </span>
        </div>
        <span className="entry-updated">Updated {formatDate(doc.updatedAt, prefs.locale)}</span>
      </div>

      <div className="entry-body">
        {source ? (
          <textarea
            className="entry-source"
            value={draft}
            spellCheck={false}
            aria-label="Markdown source"
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(true);
            }}
          />
        ) : (
          <div
            className="entry-render"
            onDoubleClick={() => setSource(true)}
            title="Double-click to edit"
          >
            {doc.body.trim() ? (
              <Markdown source={doc.body} />
            ) : (
              <p className="entry-empty-hint">Double-click to edit</p>
            )}
          </div>
        )}
      </div>

      <footer className="entry-foot">
        <span>
          {doc.body.trim().split(/\s+/).filter(Boolean).length} words · {doc.tags.length} tags · saved{" "}
          {formatDate(savedAt, prefs.locale)}
        </span>
        {!prefs.autosave && (
          <button
            className="btn sm primary"
            onClick={() => {
              onPatch({ body: draft, title: title.trim() || "Untitled" });
              setDirty(false);
              setSavedAt(Date.now());
            }}
          >
            Save
          </button>
        )}
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ canvas */

function CanvasTab() {
  const [db, update] = useDb();
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; ox: number; oy: number } | null>(null);

  const add = (kind: CanvasNode["kind"]) => {
    const node: CanvasNode = {
      id: uid(),
      kind,
      x: 80 + (db.canvas.length % 4) * 48,
      y: 80 + (db.canvas.length % 3) * 64,
      w: kind === "text" ? 220 : 180,
      h: kind === "text" ? 120 : 110,
      text: kind === "text" ? "Type your notes here..." : undefined,
      label: kind === "file" ? "untitled.md" : kind === "media" ? "image" : undefined,
    };
    update((prev) => ({ ...prev, canvas: [...prev.canvas, node] }));
    setSelected(node.id);
  };

  const pos = (n: CanvasNode) =>
    drag && drag.id === n.id ? { x: drag.x, y: drag.y } : { x: n.x, y: n.y };

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar">
        <button className="btn sm" onClick={() => add("text")}>
          <Icon name="file" size={12} /> Text
        </button>
        <button className="btn sm" onClick={() => add("media")}>
          <Icon name="image" size={12} /> Media
        </button>
        <button className="btn sm" onClick={() => add("file")}>
          <Icon name="box" size={12} /> File
        </button>
        <span className="canvas-zoom">
          <button className="icon-btn sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}>
            <Icon name="minus" size={12} />
          </button>
          <b>{Math.round(zoom * 100)}%</b>
          <button className="icon-btn sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))}>
            <Icon name="plus" size={12} />
          </button>
          <button className="btn sm ghost" onClick={() => setZoom(1)}>
            Reset
          </button>
        </span>
      </div>

      <div
        className="canvas"
        onPointerMove={(e) => {
          if (!drag) return;
          setDrag({
            ...drag,
            x: Math.round(drag.ox + e.clientX / zoom),
            y: Math.round(drag.oy + e.clientY / zoom),
          });
        }}
        onPointerUp={() => {
          if (!drag) return;
          const { id, x, y } = drag;
          update((prev) => ({
            ...prev,
            canvas: prev.canvas.map((n) => (n.id === id ? { ...n, x, y } : n)),
          }));
          setDrag(null);
        }}
        onPointerLeave={() => {
          if (!drag) return;
          const { id, x, y } = drag;
          update((prev) => ({
            ...prev,
            canvas: prev.canvas.map((n) => (n.id === id ? { ...n, x, y } : n)),
          }));
          setDrag(null);
        }}
      >
        {db.canvas.length === 0 ? (
          <div className="canvas-empty">Dashed space — drop a note, an image or a file here.</div>
        ) : (
          <div className="canvas-surface" style={{ transform: `scale(${zoom})` }}>
            <svg className="canvas-edges" width="2000" height="1400" aria-hidden>
              {db.edges.map((edge) => {
                const from = db.canvas.find((n) => n.id === edge.from);
                const to = db.canvas.find((n) => n.id === edge.to);
                if (!from || !to) return null;
                const a = pos(from);
                const b = pos(to);
                return (
                  <line
                    key={edge.id}
                    x1={a.x + from.w / 2}
                    y1={a.y + from.h / 2}
                    x2={b.x + to.w / 2}
                    y2={b.y + to.h / 2}
                    className="canvas-edge"
                  />
                );
              })}
            </svg>
            {db.canvas.map((node) => {
              const p = pos(node);
              return (
                <div
                  key={node.id}
                  className={`canvas-node ${node.kind} ${selected === node.id ? "on" : ""}`}
                  style={{ left: p.x, top: p.y, width: node.w, height: node.h }}
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest("textarea,button")) return;
                    setSelected(node.id);
                    setDrag({ id: node.id, x: p.x, y: p.y, ox: p.x - e.clientX / zoom, oy: p.y - e.clientY / zoom });
                  }}
                >
                  <header className="canvas-node-head">
                    <Icon name={node.kind === "text" ? "file" : node.kind === "media" ? "image" : "box"} size={11} />
                    <span>{node.kind === "text" ? "note" : node.label}</span>
                    <button
                      className="icon-btn xs"
                      aria-label="Delete node"
                      onClick={() => {
                        update((prev) => ({
                          ...prev,
                          canvas: prev.canvas.filter((n) => n.id !== node.id),
                          edges: prev.edges.filter((e) => e.from !== node.id && e.to !== node.id),
                        }));
                        setSelected(null);
                      }}
                    >
                      <Icon name="close" size={10} />
                    </button>
                  </header>
                  {node.kind === "text" ? (
                    <textarea
                      className="canvas-text"
                      value={node.text ?? ""}
                      aria-label="Note text"
                      onChange={(e) =>
                        update((prev) => ({
                          ...prev,
                          canvas: prev.canvas.map((n) => (n.id === node.id ? { ...n, text: e.target.value } : n)),
                        }))
                      }
                    />
                  ) : (
                    <div className="canvas-placeholder">
                      <Icon name={node.kind === "media" ? "image" : "file"} size={18} />
                      <span>{node.label}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {selected && db.canvas.length > 1 && (
          <div className="canvas-inspector">
            <span>Selected node</span>
            <button
              className="btn sm"
              onClick={() => {
                const other = db.canvas.find((n) => n.id !== selected);
                if (!other) return;
                const id = uid();
                update((prev) => ({ ...prev, edges: [...prev.edges, { id, from: selected, to: other.id }] }));
              }}
            >
              Connect to nearest
            </button>
            <button
              className="btn sm ghost"
              onClick={() =>
                update((prev) => ({
                  ...prev,
                  edges: prev.edges.filter((e) => e.from !== selected && e.to !== selected),
                }))
              }
            >
              Remove edge
            </button>
          </div>
        )}
      </div>
      <p className="canvas-note">
        Nodes drag at 60 fps; edges are straight because the reference only proves a remove affordance.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ vault */

/**
 * The real recall vault: files and notes indexed on this machine, searchable by
 * passage, citable by the companion. Nothing here is a demo record from
 * localStorage; every row is a document `vault.json` actually holds.
 */
function VaultTab() {
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [status, setStatus] = useState<{ documents: number; chunks: number; dir: string } | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VaultHit[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const load = useCallback(async () => {
    const [list, meta] = await Promise.all([
      window.viv.vault.list().catch(() => [] as VaultDocument[]),
      window.viv.vault.status().catch(() => null),
    ]);
    setDocs(list);
    setStatus(meta);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDoc = async (id: string) => {
    setSelected(id);
    const read = await window.viv.vault.read(id).catch(() => null);
    setText(read?.text ?? "");
  };

  const ingest = async (folder: boolean) => {
    setBusy(true);
    try {
      const result = folder ? await window.viv.vault.importFolder() : await window.viv.vault.import();
      await load();
      if (result.documents.length === 0 && result.skipped.length === 0) return;
      pushToast({
        title: result.documents.length
          ? `${result.documents.length} document${result.documents.length === 1 ? "" : "s"} indexed`
          : "Nothing readable was found",
        body: result.skipped.length
          ? `Skipped ${result.skipped.slice(0, 3).join(", ")}${result.skipped.length > 3 ? "…" : ""}`
          : "Split into citable passages and ready to search.",
        tone: result.documents.length ? "ok" : "info",
      });
    } catch (err) {
      pushToast({ title: "Import failed", body: String(err instanceof Error ? err.message : err), tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    setHits(await window.viv.vault.search(query.trim()).catch(() => [] as VaultHit[]));
  };

  const addNote = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await window.viv.vault.add({ title: title.trim() || undefined, body });
      setTitle("");
      setBody("");
      setNoteOpen(false);
      await load();
      pushToast({ title: "Note indexed", tone: "ok" });
    } catch (err) {
      pushToast({ title: "Could not add the note", body: String(err instanceof Error ? err.message : err), tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  const chosen = docs.find((d) => d.id === selected) ?? null;

  return (
    <div className="vault">
      <div className="vault-toolbar">
        <div className="vault-search">
          <TextInput value={query} onChange={setQuery} placeholder="Search every passage…" onEnter={() => void search()} />
          <button className="btn sm" onClick={() => void search()}>
            Find
          </button>
        </div>
        <div className="vault-actions">
          <button className="btn sm" onClick={() => void ingest(false)} disabled={busy}>
            Add files…
          </button>
          <button className="btn sm ghost" onClick={() => void ingest(true)} disabled={busy}>
            Add folder…
          </button>
          <button className="btn sm ghost" onClick={() => setNoteOpen((v) => !v)}>
            {noteOpen ? "Close note" : "Write a note"}
          </button>
        </div>
      </div>
      <p className="pane-note">
        {status ? `${status.documents} documents · ${status.chunks} passages` : "reading the index…"} · local BM25,
        nothing uploaded. She cites as [document, passage n].
      </p>

      {noteOpen && (
        <div className="pack-editor">
          <Field label="Note title">
            <TextInput value={title} onChange={setTitle} placeholder="Optional" />
          </Field>
          <Field label="Contents">
            <textarea
              className="input textarea"
              rows={5}
              value={body}
              placeholder="Paste a brief, a contract clause, meeting notes…"
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <div className="pane-actions">
            <button className="btn sm" onClick={() => void addNote()} disabled={busy || !body.trim()}>
              Index it
            </button>
          </div>
        </div>
      )}

      {hits && (
        <div className="vault-hits">
          <span className="readout-label">Passages for “{query}”</span>
          {hits.length === 0 ? (
            <Empty icon="search" title="No passage matches" body="Try fewer words, or add the document first." />
          ) : (
            hits.map((hit, i) => (
              <article key={`${hit.documentId}-${hit.chunk}-${i}`} className="vault-hit">
                <header>
                  <button className="vault-hit-title" onClick={() => void openDoc(hit.documentId)}>
                    {hit.title}
                  </button>
                  <Chip tone="idle">passage {hit.chunk}</Chip>
                  <span className="lib-time">{hit.score}</span>
                </header>
                <p>{hit.text}</p>
              </article>
            ))
          )}
        </div>
      )}

      <div className="vault-layout">
        <div className="vault-list">
          {docs.length === 0 ? (
            <Empty
              icon="box"
              title="The vault is empty"
              body="Add the PDFs, notes and documents you keep explaining to her, and she can look them up from then on."
              action={
                <button className="btn sm primary" onClick={() => void ingest(false)}>
                  Add files
                </button>
              }
            />
          ) : (
            docs.map((doc) => (
              <div key={doc.id} className={`vault-row ${selected === doc.id ? "on" : ""}`}>
                <button className="vault-row-main" onClick={() => void openDoc(doc.id)} title={doc.source}>
                  <span className="vault-row-title">{doc.title}</span>
                  <small>
                    {doc.kind === "note" ? "note" : "file"} · {doc.chunks} passage{doc.chunks === 1 ? "" : "s"} ·{" "}
                    {formatDate(doc.updatedAt, "en-GB")}
                  </small>
                </button>
                <button
                  className="icon-btn xs"
                  title="Forget this document"
                  aria-label={`Forget ${doc.title}`}
                  onClick={() => {
                    void window.viv.vault.forget(doc.id).then((list) => {
                      setDocs(list);
                      if (selected === doc.id) {
                        setSelected(null);
                        setText("");
                      }
                      pushToast({ title: "Forgotten", body: `${doc.title} left the vault.`, tone: "info" });
                    });
                  }}
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="vault-preview">
          {!chosen ? (
            <Empty icon="doc" title="Pick a document" body="Its passages are what she reads and cites." />
          ) : (
            <>
              <header className="vault-preview-head">
                <div>
                  <h2>{chosen.title}</h2>
                  <p title={chosen.source}>
                    {chosen.kind === "file" ? chosen.source : "note"} · {chosen.chars.toLocaleString()} chars ·{" "}
                    {chosen.chunks} passages
                  </p>
                </div>
                <button className="btn sm ghost" onClick={() => void openDoc(chosen.id)}>
                  Reload
                </button>
              </header>
              <div className="vault-text">
                <Markdown source={text} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ packs */

/**
 * Context packs: named bundles that ride along with the conversation while they
 * are attached. One at a time, so the person always knows what she is carrying.
 */
function PacksTab() {
  const [packs, setPacks] = useState<ContextPack[]>([]);
  const [attached, setAttached] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id?: string; name: string; description: string; body: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [list, active] = await Promise.all([
      window.viv.packs.list().catch(() => [] as ContextPack[]),
      window.viv.packs.attached().catch(() => null),
    ]);
    setPacks(list);
    setAttached(active);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft?.name.trim()) return;
    setSaving(true);
    try {
      await window.viv.packs.save(draft);
      setDraft(null);
      await load();
      pushToast({ title: "Pack saved", body: "Attach it to carry it into every turn.", tone: "ok" });
    } catch (err) {
      pushToast({ title: "Could not save the pack", body: String(err instanceof Error ? err.message : err), tone: "bad" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="vault packs-pane">
      <p className="pane-note">
        A pack is context you would otherwise paste each time: guardrails, a client's details, a syllabus. The
        attached pack is included in every turn; the rest wait until she reads them.
      </p>
      <div className="vault-toolbar">
        <span className="readout-label">{packs.length} pack{packs.length === 1 ? "" : "s"}</span>
        <div className="vault-actions">
          <button className="btn sm" onClick={() => setDraft({ name: "", description: "", body: "" })}>
            New pack
          </button>
        </div>
      </div>

      {packs.length === 0 ? (
        <Empty
          icon="box"
          title="No packs yet"
          body="Use one for a long project, a client, a course, or the rules she must never break."
          action={
            <button className="btn sm primary" onClick={() => setDraft({ name: "", description: "", body: "" })}>
              Create a pack
            </button>
          }
        />
      ) : (
        <div className="list">
          {packs.map((pack) => (
            <div key={pack.id} className="row-line">
              <div>
                <div>
                  <strong>{pack.name}</strong>{" "}
                  {attached === pack.id ? (
                    <Chip tone="live" dot>
                      attached
                    </Chip>
                  ) : null}
                </div>
                <small>
                  {pack.description || `${pack.body.length.toLocaleString()} chars`} · updated{" "}
                  {formatDate(pack.updatedAt, "en-GB")}
                </small>
              </div>
              <div className="pack-actions">
                <button
                  className="btn sm ghost"
                  onClick={async () => {
                    setAttached(await window.viv.packs.attach(attached === pack.id ? null : pack.id));
                  }}
                >
                  {attached === pack.id ? "detach" : "attach"}
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() =>
                    setDraft({ id: pack.id, name: pack.name, description: pack.description, body: pack.body })
                  }
                >
                  edit
                </button>
                <button
                  className="btn sm ghost"
                  onClick={async () => {
                    await window.viv.packs.remove(pack.id).catch(() => undefined);
                    await load();
                  }}
                >
                  delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <div className="pack-editor">
          <Field label="Pack name">
            <TextInput value={draft.name} onChange={(name) => setDraft({ ...draft, name })} placeholder="Acme onboarding" />
          </Field>
          <Field label="One line about it">
            <TextInput
              value={draft.description}
              onChange={(description) => setDraft({ ...draft, description })}
              placeholder="What this pack is for"
            />
          </Field>
          <Field label="Contents" hint="Guardrails first, then the reference material. Keep secrets out.">
            <textarea
              className="input textarea"
              rows={12}
              value={draft.body}
              placeholder={"Rules:\n- Never quote the internal discount.\n\nReference:\n…"}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </Field>
          <div className="pane-actions">
            <button className="btn sm" onClick={() => void save()} disabled={saving || !draft.name.trim()}>
              Save pack
            </button>
            <button className="btn sm ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <span className="pane-note">Attach it from the list, or from the chip above the chat composer.</span>
          </div>
        </div>
      )}
    </div>
  );
}
