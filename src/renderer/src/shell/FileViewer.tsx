import { useCallback, useEffect, useMemo, useState } from "react";
import type { FileNode, FilePreview } from "../../../shared/types";
import { Icon } from "./icons";

/**
 * FILE VIEWER — the place a "view file" in chat lands.
 *
 * It lists the folders the person allowed in Settings, not the whole disk, and
 * reads through the same root check the tools use. Everything is rendered as
 * text with line numbers; binaries are named rather than decoded.
 */

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function when(at: number) {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function FileViewer({ initialPath, onClose }: { initialPath?: string; onClose: () => void }) {
  const [files, setFiles] = useState<FileNode[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialPath ?? null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    void window.viv.files
      .list()
      .then(setFiles)
      .catch((err: unknown) => {
        setFiles([]);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  useEffect(reload, [reload]);

  // An empty viewer is a dead end unless the person can add a folder from here.
  const addFolder = () => {
    void window.viv.settings.pickRoot().then(reload);
  };

  const open = useCallback((target: string) => {
    setSelected(target);
    setError(null);
    void window.viv.files
      .read(target)
      .then(setPreview)
      .catch((err: unknown) => {
        setPreview(null);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  // A path handed in from a chat tool row opens straight away.
  useEffect(() => {
    if (initialPath) open(initialPath);
  }, [initialPath, open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!files) return [];
    if (!q) return files;
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, query]);

  const lines = useMemo(() => {
    if (!preview || preview.binary) return [];
    return preview.text.split("\n").slice(0, 4000);
  }, [preview]);

  return (
    <div className="fileview-scrim" role="dialog" aria-label="Files">
      <div className="fileview">
        <header className="fileview-head">
          <div className="fileview-title">
            <Icon name="folder" size={15} />
            <b>Files</b>
            <span>{files ? `${files.length} files` : "reading folders…"}</span>
          </div>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close files">
            <Icon name="close" size={13} />
          </button>
        </header>

        <div className="fileview-body">
          <aside className="fileview-list" aria-label="Files">
            <label className="search-inline">
              <Icon name="search" size={12} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a file"
                aria-label="Find a file"
                autoFocus
              />
            </label>

            {files && files.length === 0 && (
              <div className="fileview-empty">
                <p>No folders allowed yet.</p>
                <p className="pane-note">
                  Settings → Folders adds one. Nothing outside those folders is listed.
                </p>
                <button className="btn sm primary" onClick={addFolder}>
                  <Icon name="folder" size={12} />
                  Add a folder
                </button>
              </div>
            )}

            <div className="fileview-rows">
              {shown.slice(0, 300).map((f) => (
                <button
                  key={f.path}
                  className={`fileview-row ${selected === f.path ? "on" : ""}`}
                  onClick={() => open(f.path)}
                  title={f.path}
                >
                  <span className="fileview-row-main">
                    <b>{f.name}</b>
                    <em>
                      {f.dir} · {size(f.size)}
                    </em>
                  </span>
                  <span className="fileview-row-at">{when(f.at)}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="fileview-pane" aria-label="Preview">
            {error && <div className="fileview-error">{error}</div>}
            {!preview && !error && (
              <div className="fileview-placeholder">
                <Icon name="file" size={22} />
                <p>Pick a file to read it here.</p>
                <p className="pane-note">Text only. Nothing is written from this panel.</p>
              </div>
            )}
            {preview && (
              <>
                <header className="fileview-file-head">
                  <div>
                    <b>{preview.name}</b>
                    <code>{preview.path}</code>
                  </div>
                  <div className="fileview-file-actions">
                    <span className="pane-note">
                      {size(preview.bytes)}
                      {preview.truncated ? " · first 400 KB" : ""}
                    </span>
                    <button className="btn sm" onClick={() => void window.viv.files.open(preview.path)}>
                      <Icon name="link" size={12} />
                      Open
                    </button>
                  </div>
                </header>
                {preview.binary ? (
                  <div className="fileview-placeholder">
                    <Icon name="box" size={22} />
                    <p>Binary file — not previewed.</p>
                  </div>
                ) : (
                  <div className="fileview-code" role="region" aria-label={`${preview.name} contents`}>
                    {lines.map((line, i) => (
                      <div className="fileview-line" key={i}>
                        <span className="fileview-n">{i + 1}</span>
                        <span className="fileview-t">{line || " "}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Open the viewer from anywhere: chat rows, the brain's explorer. */
export const FILE_EVENT = "viv:open-file";
export function openFileViewer(path?: string) {
  window.dispatchEvent(new CustomEvent(FILE_EVENT, { detail: { path } }));
}
