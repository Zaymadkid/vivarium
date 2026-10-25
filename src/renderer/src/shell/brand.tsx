import type { CSSProperties } from "react";
import {
  siAirtable,
  siAsana,
  siDropbox,
  siFigma,
  siGithub,
  siGmail,
  siGooglecalendar,
  siGoogledrive,
  siHubspot,
  siJira,
  siLinear,
  siNotion,
  siPostgresql,
  siPosthog,
  siReddit,
  siStripe,
  siTelegram,
  siTrello,
  siVercel,
  siX,
  siYoutube,
} from "simple-icons";

/**
 * Real brand marks for the services this build can plug into.
 *
 * Simple Icons gives the official single-colour path and hex for each service,
 * which is drawn on a light tile so a black mark (Notion, GitHub, Vercel) stays
 * legible. Three services are absent from that set — Slack, OneDrive and
 * Outlook have been withdrawn for trademark reasons — so those are drawn here
 * from their published geometry, in their own colours.
 */

export interface Brand {
  title: string;
  hex: string;
  path: string;
}

/** Normalise "Google Drive", "google-drive", "googledrive" to one key. */
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const brands: Record<string, Brand> = {};
const add = (alias: string, brand: Brand) => {
  brands[key(alias)] = brand;
};
const fromSimple = (alias: string, icon: { title: string; hex: string; path: string }) =>
  add(alias, { title: icon.title, hex: `#${icon.hex}`, path: icon.path });

fromSimple("Gmail", siGmail);
fromSimple("Google Drive", siGoogledrive);
fromSimple("Notion", siNotion);
fromSimple("Linear", siLinear);
fromSimple("GitHub", siGithub);
fromSimple("Figma", siFigma);
fromSimple("Vercel", siVercel);
fromSimple("Telegram", siTelegram);
fromSimple("Google Calendar", siGooglecalendar);
fromSimple("Asana", siAsana);
fromSimple("Trello", siTrello);
fromSimple("Jira", siJira);
fromSimple("Airtable", siAirtable);
fromSimple("Dropbox", siDropbox);
fromSimple("HubSpot", siHubspot);
fromSimple("Stripe", siStripe);
fromSimple("X", siX);
fromSimple("YouTube", siYoutube);
fromSimple("Reddit", siReddit);
fromSimple("PostHog", siPosthog);
fromSimple("Postgres", siPostgresql);
fromSimple("PostgreSQL", siPostgresql);

/* ---- the three Simple Icons no longer ships ---- */

brands[key("Slack")] = {
  title: "Slack",
  hex: "#E01E5A",
  path: "",
  // four lobes, drawn separately below
};

brands[key("OneDrive")] = {
  title: "OneDrive",
  hex: "#0078D4",
  path:
    "M7.3 18.5a4.15 4.15 0 0 1 .35-8.28 5.75 5.75 0 0 1 10.85 1.6 3.6 3.6 0 0 1-.55 6.68H7.3Z",
};

brands[key("Outlook")] = {
  title: "Outlook",
  hex: "#0F6CBD",
  path: "",
};

function CustomMark({ k }: { k: string }) {
  if (k === "slack") {
    return (
      <>
        <rect x="8.2" y="2" width="2.7" height="9.2" rx="1.35" fill="#36C5F0" />
        <rect x="12.8" y="8.2" width="9.2" height="2.7" rx="1.35" fill="#2EB67D" />
        <rect x="13.1" y="12.8" width="2.7" height="9.2" rx="1.35" fill="#E01E5A" />
        <rect x="2" y="13.1" width="9.2" height="2.7" rx="1.35" fill="#ECB22E" />
      </>
    );
  }
  if (k === "outlook") {
    return (
      <>
        <rect x="2.6" y="2.6" width="18.8" height="18.8" rx="3.4" fill="#0F6CBD" />
        <ellipse cx="12" cy="12.2" rx="4.6" ry="4.9" fill="#fff" />
        <ellipse cx="12" cy="12.2" rx="2.5" ry="2.8" fill="#0F6CBD" />
        <path d="M2.6 6.1 12 11.4l9.4-5.3" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1.1" />
      </>
    );
  }
  return null;
}

/** A service's real mark on a light tile. Falls back to its initial. */
export function BrandLogo({
  name,
  size = 30,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const brand = brands[key(name)];
  const custom = key(name);
  const initial = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();

  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.max(6, Math.round(size * 0.24)),
    background: brand ? "rgba(255,255,255,0.94)" : `hsl(${(key(name).length * 47) % 360} 60% 22%)`,
    padding: Math.round(size * 0.16),
    color: brand?.hex ?? "#fff",
  };

  return (
    <span className={`brand-logo ${className ?? ""}`} style={style} title={brand?.title ?? name} aria-hidden>
      {brand ? (
        <svg viewBox="0 0 24 24" width="100%" height="100%" role="img">
          {custom === "slack" || custom === "outlook" ? (
            <CustomMark k={custom} />
          ) : (
            <path d={brand.path} fill="currentColor" />
          )}
        </svg>
      ) : (
        <em>{initial}</em>
      )}
    </span>
  );
}
