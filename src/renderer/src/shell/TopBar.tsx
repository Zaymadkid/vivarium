import { useState } from "react";
import { Icon } from "./icons";
import { Wordmark } from "./logo";
import { AccountMenu, LocaleMenu, NotificationsPanel, initials, type Notice } from "./Menus";

export function TopBar({
  onSearch,
  notices,
  unread,
  locale,
  onLocale,
  accountName,
  accountEmail,
  onSettings,
  onGettingStarted,
  onTour,
  onLogOut,
  onOpenLedger,
  onHome,
  onPlaces,
  onOverlay,
}: {
  onSearch: () => void;
  notices: Notice[];
  unread: number;
  locale: string;
  onLocale: (value: string) => void;
  accountName: string;
  accountEmail: string;
  onSettings: () => void;
  onGettingStarted: () => void;
  onTour: () => void;
  onLogOut: () => void;
  onOpenLedger: () => void;
  onHome: () => void;
  onPlaces: () => void;
  onOverlay: () => void;
}) {
  const [open, setOpen] = useState<"none" | "bell" | "locale" | "account">("none");
  const toggle = (which: "bell" | "locale" | "account") =>
    setOpen((v) => (v === which ? "none" : which));

  return (
    <header className="topbar">
      <button className="brandmark-btn" onClick={onHome} title="Back to the world">
        <Wordmark />
      </button>

      <div className="top-right">
        <button className="search-trigger" onClick={onPlaces} aria-label="Places" title="Places in this world">
          <Icon name="grid" size={14} />
        </button>

        <button className="search-trigger" onClick={onSearch} aria-label="Search" title="Search — ⌘K">
          <Icon name="search" size={14} />
        </button>

        <button
          className="search-trigger"
          onClick={onOverlay}
          aria-label="On-screen companion"
          title="On-screen companion — Ctrl+Shift+Space to talk"
        >
          <Icon name="dish" size={15} />
        </button>

        <span className="menu-anchor">
          <button
            className="icon-btn"
            onClick={() => toggle("bell")}
            aria-label="Notifications"
            aria-expanded={open === "bell"}
          >
            <Icon name="bell" size={16} />
            {unread > 0 && <i className="unread" />}
          </button>
          {open === "bell" && (
            <NotificationsPanel
              notices={notices}
              onClose={() => setOpen("none")}
              onOpenLedger={() => {
                setOpen("none");
                onOpenLedger();
              }}
            />
          )}
        </span>

        <span className="menu-anchor">
          <button
            className="icon-btn"
            onClick={() => toggle("locale")}
            aria-label={`Language ${locale}`}
            aria-expanded={open === "locale"}
            title={locale}
          >
            <Icon name="globe" size={16} />
          </button>
          {open === "locale" && (
            <LocaleMenu
              locale={locale}
              onPick={(value) => {
                onLocale(value);
                setOpen("none");
              }}
              onClose={() => setOpen("none")}
            />
          )}
        </span>

        <span className="menu-anchor">
          <button
            className="avatar"
            onClick={() => toggle("account")}
            aria-label="Your account"
            aria-expanded={open === "account"}
            title={accountName}
          >
            {initials(accountName)}
          </button>
          {open === "account" && (
            <AccountMenu
              name={accountName}
              email={accountEmail}
              onClose={() => setOpen("none")}
              onSettings={() => {
                setOpen("none");
                onSettings();
              }}
              onGettingStarted={() => {
                setOpen("none");
                onGettingStarted();
              }}
              onTour={() => {
                setOpen("none");
                onTour();
              }}
              onLogOut={() => {
                setOpen("none");
                onLogOut();
              }}
            />
          )}
        </span>
      </div>
    </header>
  );
}
