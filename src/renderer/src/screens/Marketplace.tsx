import { useEffect, useMemo, useState } from "react";
import { Icon } from "../shell/icons";
import { ToolBrief } from "../shell/Brief";
import { formatMoney, usePrefs } from "../shell/prefs";
import { useDb, type MarketItem } from "../shell/data";
import { pushToast } from "../shell/toasts";
import {
  Chip,
  Dot,
  Empty,
  LoadingRows,
  Modal,
  ProgressRule,
} from "../shell/ui";

const SHELVES = ["All", "Productivity", "Research", "Build", "Studio"] as const;

const STATE_COPY: Record<MarketItem["state"], string> = {
  owned: "Hers now.",
  included: "Nothing to pay",
  connect: "Works once you connect it",
  build: "We build it for you",
  training: "Two hours with a human",
};

export function MarketplaceScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const [db, update] = useDb();
  const [prefs, setPrefs] = usePrefs();
  const [shelf, setShelf] = useState<(typeof SHELVES)[number]>("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(db.market[0]?.id ?? null);
  const [buying, setBuying] = useState<MarketItem | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setLoading(false), 180);
    return () => window.clearTimeout(id);
  }, []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.market.filter((m) => {
      if (shelf !== "All" && m.shelf !== shelf) return false;
      return !q || `${m.name} ${m.blurb} ${m.shelf}`.toLowerCase().includes(q);
    });
  }, [db.market, shelf, query]);

  const detail = db.market.find((m) => m.id === selected) ?? null;
  const owned = db.market.filter((m) => m.state === "owned" || m.state === "included").length;

  const buy = (item: MarketItem) => {
    setBuying(null);
    setInstalling(item.id);
    window.setTimeout(() => {
      update((prev) => ({
        ...prev,
        market: prev.market.map((m) => (m.id === item.id ? { ...m, state: "owned" } : m)),
      }));
      setInstalling(null);
      if (item.price) {
        setPrefs({ credits: Math.max(0, prefs.credits - Math.round(item.price * 70)) });
      }
      pushToast({
        title: `${item.name} installed`,
        body: "It is on the shelf in this world now.",
        tone: "ok",
      });
    }, 1300);
  };

  return (
    <section className="screen" aria-label="Marketplace">
      <header className="screen-head">
        <div className="screen-head-main">
          <h1 className="screen-title">Marketplace</h1>
          <p className="screen-sub">
            {db.market.length} tools · {owned} already here · {prefs.credits.toLocaleString("en-US")} credits
          </p>
        </div>
        <div className="screen-actions">
          <span className="search-inline">
            <Icon name="search" size={13} />
            <input
              value={query}
              placeholder="Search the shelves"
              aria-label="Search the shelves"
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
          <button className="btn sm ghost" onClick={() => onOpen("credits")}>
            <Icon name="credit" size={12} />
            Credits
          </button>
        </div>
      </header>

      <div className="screen-body">
        <ToolBrief
          does="Sells finished tools as one-click installs, and offers the studio work that is not a download."
          connects="Your local world, your connected integrations and your credit balance."
          needs="A priced tool needs credits. Anything with a token needs that integration connected first."
          note="Where this build stops: there is no checkout. Installing takes credits from the local ledger and takes no money."
        />

        <div className="filter-strip">
          {SHELVES.map((s) => (
            <button
              key={s}
              className={`filter-chip ${shelf === s ? "on" : ""}`}
              onClick={() => setShelf(s)}
            >
              {s}
            </button>
          ))}
          <span className="filter-note">{items.length} on this shelf</span>
        </div>

        {error && (
          <div className="errorblock" role="alert">
            <span className="errorblock-icon">
              <Icon name="warn" size={15} />
            </span>
            <div className="errorblock-main">
              <p>{error}</p>
            </div>
            <button className="btn sm" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        <div className="market-layout">
          <div className="market-grid-wrap">
            {loading ? (
              <LoadingRows n={4} label="Loading the shelves" />
            ) : items.length === 0 ? (
              <Empty
                icon="box"
                title="Nothing on the shelves matches that yet"
                body="Try another shelf, or a shorter search."
                action={
                  <button
                    className="btn"
                    onClick={() => {
                      setShelf("All");
                      setQuery("");
                    }}
                  >
                    Clear filters
                  </button>
                }
              />
            ) : (
              <div className="market-grid">
                {items.map((m) => (
                  <button
                    key={m.id}
                    className={`market-card ${selected === m.id ? "on" : ""}`}
                    onClick={() => setSelected(m.id)}
                  >
                    <span className="market-art" data-shelf={m.shelf}>
                      <Icon
                        name={
                          m.shelf === "Build"
                            ? "cpu"
                            : m.shelf === "Research"
                              ? "book"
                              : m.shelf === "Studio"
                                ? "spark"
                                : "box"
                        }
                        size={18}
                      />
                    </span>
                    <span className="market-main">
                      <span className="market-top">
                        <b>{m.name}</b>
                        <em className="mono">
                          {m.price === null ? "—" : formatMoney(m.price, prefs.currency)}
                        </em>
                      </span>
                      <p>{m.blurb}</p>
                      <span className="market-foot">
                        <Chip tone="idle">{m.shelf}</Chip>
                        <Chip
                          tone={
                            m.state === "owned" || m.state === "included"
                              ? "live"
                              : m.state === "build" || m.state === "training"
                                ? "warm"
                                : "idle"
                          }
                        >
                          {m.state}
                        </Chip>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <aside className="market-detail" aria-label="Tool detail">
            {!detail ? (
              <p className="pane-note center">Pick a tool.</p>
            ) : (
              <>
                <header className="market-detail-head">
                  <span className="market-art lg" data-shelf={detail.shelf}>
                    <Icon
                      name={
                        detail.shelf === "Build"
                          ? "cpu"
                          : detail.shelf === "Research"
                            ? "book"
                            : detail.shelf === "Studio"
                              ? "spark"
                              : "box"
                      }
                      size={22}
                    />
                  </span>
                  <div>
                    <p>{detail.name}</p>
                    <span>{detail.shelf}</span>
                  </div>
                  <Chip tone={detail.price === null ? "idle" : "warm"}>
                    {detail.price === null ? STATE_COPY[detail.state] : formatMoney(detail.price, prefs.currency)}
                  </Chip>
                </header>

                <p className="market-lede">{detail.blurb}</p>

                <div className="tool-brief inline">
                  <div>
                    <span className="tb-label">What it does</span>
                    <p>{detail.does}</p>
                  </div>
                  <div>
                    <span className="tb-label">What it connects to</span>
                    <p>{detail.connects}</p>
                  </div>
                  <div>
                    <span className="tb-label">What it needs</span>
                    <p>{detail.needs}</p>
                  </div>
                </div>

                {installing === detail.id ? (
                  <div className="install-state" role="status">
                    <ProgressRule value={0.6} />
                    <span>Installing locally…</span>
                  </div>
                ) : detail.state === "owned" ? (
                  <div className="market-actions">
                    <Chip tone="live" dot>
                      {STATE_COPY.owned}
                    </Chip>
                    <button className="btn sm" onClick={() => onOpen(detail.shelf === "Research" ? "skills" : "documents")}>
                      Open
                    </button>
                  </div>
                ) : detail.state === "included" ? (
                  <div className="market-actions">
                    <Chip tone="live" dot>
                      {STATE_COPY.included}
                    </Chip>
                    <button className="btn sm" onClick={() => onOpen("documents")}>
                      Use it
                    </button>
                  </div>
                ) : detail.state === "connect" ? (
                  <div className="market-actions">
                    <button className="btn sm primary" onClick={() => onOpen("integrations")}>
                      Connect what it needs
                    </button>
                    <span className="pane-note">Then it installs with no further steps.</span>
                  </div>
                ) : detail.state === "build" ? (
                  <div className="market-actions">
                    <Chip tone="warm">{STATE_COPY.build}</Chip>
                    <button
                      className="btn sm"
                      onClick={() =>
                        pushToast({
                          title: "Nothing to book here",
                          body: "Studio work is scheduled by a person, not this build.",
                          tone: "info",
                        })
                      }
                    >
                      Start a session
                    </button>
                  </div>
                ) : (
                  <div className="market-actions">
                    <Chip tone="warm">{STATE_COPY.training}</Chip>
                    <button
                      className="btn sm"
                      onClick={() =>
                        pushToast({
                          title: "No calendar in this build",
                          body: "Bookings happen with a person.",
                          tone: "info",
                        })
                      }
                    >
                      Book
                    </button>
                  </div>
                )}

                <span className="section-label">Also on this shelf</span>
                <div className="list">
                  {db.market
                    .filter((m) => m.shelf === detail.shelf && m.id !== detail.id)
                    .slice(0, 3)
                    .map((m) => (
                      <button key={m.id} className="row-line" onClick={() => setSelected(m.id)}>
                        <Dot tone={m.state === "owned" ? "live" : "idle"} />
                        <span>{m.name}</span>
                        <em className="mono">{m.price === null ? "—" : formatMoney(m.price, prefs.currency)}</em>
                      </button>
                    ))}
                </div>
              </>
            )}
          </aside>
        </div>
      </div>

      {buying && (
        <Modal
          title={`Get ${buying.name}`}
          onClose={() => setBuying(null)}
          width={400}
          footer={
            <>
              <button className="btn ghost" onClick={() => setBuying(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => buy(buying)}>
                Install · {buying.price === null ? "free" : formatMoney(buying.price, prefs.currency)}
              </button>
            </>
          }
        >
          <p className="modal-lede">
            This takes {buying.price === null ? "no credits" : `${Math.round((buying.price ?? 0) * 70)} credits`}{" "}
            from the local ledger. No payment provider is wired in this build, so no money moves.
          </p>
          <p className="pane-note">{buying.needs}</p>
        </Modal>
      )}
    </section>
  );
}
