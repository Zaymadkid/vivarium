import { useEffect, useState } from "react";

/** The tool surfaces are local-first in this build: one JSON document on this machine. */

export interface Doc {
  id: string;
  title: string;
  body: string;
  tags: string[];
  folderId: string | null;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
}

export interface CanvasNode {
  id: string;
  kind: "text" | "media" | "file";
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  label?: string;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  docs: string[];
  integrations: string[];
  instructions: string;
  status: "draft" | "ready" | "error";
  createdAt: number;
}

export interface Integration {
  id: string;
  name: string;
  category: string;
  blurb: string;
  does: string;
  connects: string;
  needs: string;
  scopes: string[];
  status: "available" | "connected" | "connecting" | "error";
}

export interface Run {
  id: string;
  at: number;
  status: "ok" | "failed" | "running";
  duration: string;
}

export interface Automation {
  id: string;
  name: string;
  schedule: string | null;
  webhook: string | null;
  assignee: string;
  prompt: string;
  status: "running" | "paused" | "error";
  runs: Run[];
}

export interface FolderShare {
  id: string;
  name: string;
  rail: string;
  count: number;
  on: boolean;
}

export interface Audit {
  id: string;
  at: number;
  who: string;
  what: string;
}

export interface Portal {
  id: string;
  partner: string;
  email: string;
  status: "synced" | "saving" | "error";
  shared: FolderShare[];
  received: FolderShare[];
  audit: Audit[];
}

export interface MarketItem {
  id: string;
  name: string;
  blurb: string;
  shelf: string;
  price: number | null;
  state: "owned" | "connect" | "build" | "training" | "included";
  does: string;
  connects: string;
  needs: string;
}

export interface LibraryItem {
  id: string;
  kind: "Uploaded" | "Generated";
  source: "Local" | "GitHub" | "Drive" | "Notion" | "OneDrive" | "Outlook" | "Other";
  at: number;
  status: "running" | "done" | "failed";
  cost: number;
  asked: string;
  done: string;
}

export interface Goal {
  id: string;
  title: string;
  status: "open" | "working" | "done";
  progress: number;
  agentId: string;
}

export interface Db {
  folders: Folder[];
  docs: Doc[];
  canvas: CanvasNode[];
  edges: CanvasEdge[];
  skills: Skill[];
  integrations: Integration[];
  automations: Automation[];
  portals: Portal[];
  market: MarketItem[];
  library: LibraryItem[];
  goals: Goal[];
}

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const WEEK = 7 * 86_400_000;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const ago = (ms: number) => Date.now() - ms;

function integration(
  name: string,
  category: string,
  blurb: string,
  does: string,
  connects: string,
  needs: string,
  scopes: string[],
  status: Integration["status"] = "available",
): Integration {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name,
    category,
    blurb,
    does,
    connects,
    needs,
    scopes,
    status,
  };
}

const SEED: Db = {
  folders: [
    { id: "f-product", name: "Product" },
    { id: "f-personal", name: "Personal" },
  ],
  docs: [
    {
      id: "d-world",
      title: "World notes",
      folderId: "f-product",
      tags: ["world", "design"],
      updatedAt: ago(2 * HOUR),
      body: `# World notes

The stage is a **single fixed viewport**. Nothing scrolls except the panes inside it.

## What the world is for

- companions stand in it, and their state is readable from across the room
- the console is the only place that lists work
- drawers overlay the sea; they never resize it

## Measured chrome

| region | size |
| --- | --- |
| top bar | 54 px |
| left drawer | 375 px |
| chat drawer | 450 px |

\`\`\`ts
const ease = "cubic-bezier(.2,.9,.3,1)";
\`\`\`

> One accent, one page colour, one hairline.

That is the whole language.`,
    },
    {
      id: "d-providers",
      title: "Provider checklist",
      folderId: "f-product",
      tags: ["providers"],
      updatedAt: ago(1 * DAY),
      body: `## Before a provider is "supported"

1. a real request shape, not a guess
2. a cancel path
3. an error line that names the provider
4. a key that never enters the renderer

The mock provider exists so the app is never empty on a plane.`,
    },
    {
      id: "d-voice",
      title: "Voice brief",
      folderId: null,
      tags: ["voice", "copy"],
      updatedAt: ago(4 * DAY),
      body: `# Voice

Short sentences. Concrete nouns. No exclamation marks.

- Say what happened, then what needs the human.
- Never apologise twice.
- Numbers are mono and tabular; prose is sans.`,
    },
  ],
  canvas: [
    { id: "n-1", kind: "text", x: 64, y: 56, w: 236, h: 132, text: "Map the world before the tools." },
    { id: "n-2", kind: "text", x: 360, y: 188, w: 220, h: 112, text: "Every panel has one job." },
    { id: "n-3", kind: "file", x: 96, y: 260, w: 168, h: 84, label: "chrome-measurements.md" },
  ],
  edges: [{ id: "e-1", from: "n-1", to: "n-2" }],
  skills: [
    {
      id: "s-inbox",
      name: "Inbox triage",
      description: "Sort the morning inbox into reply, read, and archive, then draft the replies.",
      docs: ["d-voice"],
      integrations: ["gmail"],
      instructions: "Read every unread thread. Group by sender. Draft replies under 90 words.",
      status: "ready",
      createdAt: ago(9 * DAY),
    },
    {
      id: "s-release",
      name: "Release notes",
      description: "Turn merged pull requests into a short, human changelog.",
      docs: [],
      integrations: ["github", "linear"],
      instructions: "One line per user-visible change. Never list internal refactors.",
      status: "ready",
      createdAt: ago(2 * DAY),
    },
    {
      id: "s-research",
      name: "Research digest",
      description: "Collect five sources on a question and return a page with the disagreements intact.",
      docs: ["d-world"],
      integrations: [],
      instructions: "",
      status: "draft",
      createdAt: ago(6 * HOUR),
    },
  ],
  integrations: [
    integration("Gmail", "Communication", "Read and send email from your Gmail", "Reads threads, drafts replies, and sends only after you approve.", "Google Workspace, over OAuth.", "A Google account and a verified redirect.", ["gmail.readonly", "gmail.compose", "gmail.send"]),
    integration("Google Drive", "Docs & Data", "Work with your Google Drive files", "Lists folders, reads documents, and writes exports back.", "Drive v3 over OAuth.", "A Google account; the folder is chosen once.", ["drive.file", "drive.metadata.readonly"]),
    integration("Notion", "Docs & Data", "Read and write Notion pages", "Searches the workspace, reads pages, and appends blocks.", "The Notion API over an internal integration token.", "An internal token shared with the pages you want.", ["read_content", "insert_content"]),
    integration("Linear", "Dev Tools", "Manage your Linear issues", "Lists issues, moves state, and comments with a link back to the run.", "Linear GraphQL over a personal API key.", "A personal key with team access.", ["issues:read", "issues:write"]),
    integration("GitHub", "Dev Tools", "Manage your GitHub repos, issues, and pull requests", "Reads diffs, opens pull requests, and comments on review threads.", "GitHub REST over a fine-grained token.", "A fine-grained token scoped to one owner.", ["repo:read", "pull_requests:write"]),
    integration("Figma", "Dev Tools", "Read frames and export assets", "Reads the current file's frames and exports PNGs at 2x.", "Figma REST over a personal access token.", "A personal access token.", ["file_read"]),
    integration("Vercel", "Dev Tools", "Watch deployments and roll back", "Reads deployment state and can promote a previous build.", "Vercel REST over a team token.", "A team token; production promotion asks every time.", ["deployments:read", "deployments:write"]),
    integration("Slack", "Communication", "Post updates into a channel", "Sends a message and threads follow-ups under it.", "Slack Web API over a bot token.", "A bot invited to the channel.", ["chat:write", "channels:read"]),
    integration("Telegram", "Communication", "Reach her from your phone", "Sends and receives direct messages from a private bot.", "Telegram Bot API over a bot token you create with BotFather.", "A bot token and your chat id.", ["sendMessage", "getUpdates"]),
    integration("Google Calendar", "Docs & Data", "Read and create events", "Reads the next seven days and creates events with reminders.", "Calendar v3 over OAuth.", "A Google account and one chosen calendar.", ["calendar.readonly", "calendar.events"]),
    integration("Asana", "Project Mgmt", "Track tasks and projects", "Lists tasks, moves sections, and writes a run summary to the task.", "Asana REST over a personal token.", "A personal token with project access.", ["tasks:read", "tasks:write"]),
    integration("Trello", "Project Mgmt", "Move cards between lists", "Reads boards and moves cards when a run finishes.", "Trello REST over an API key and token pair.", "A key and a token, both yours.", ["boards:read", "cards:write"]),
    integration("Jira", "Project Mgmt", "Search and update issues", "Runs JQL searches and comments with the result summary.", "Jira Cloud REST over an API token.", "Site URL, email, and an API token.", ["issues:read", "issues:write"]),
    integration("Airtable", "Docs & Data", "Read and write bases", "Reads records and appends a row per run.", "Airtable REST over a personal access token.", "A token scoped to one base.", ["records:read", "records:write"]),
    integration("Dropbox", "Docs & Data", "Sync files into a folder", "Watches one folder and copies new files into the library.", "Dropbox API over OAuth.", "A Dropbox account.", ["files.content.read", "files.content.write"]),
    integration("OneDrive", "Docs & Data", "Read files from OneDrive", "Lists files and reads the ones you point at.", "Microsoft Graph over OAuth.", "A Microsoft account.", ["files.read"]),
    integration("Outlook", "Communication", "Read and send Outlook mail", "Reads the inbox and drafts replies.", "Microsoft Graph over OAuth.", "A Microsoft account.", ["mail.read", "mail.send"]),
    integration("HubSpot", "CRM & Sales", "Keep contacts and deals current", "Reads contacts and appends notes to the matching deal.", "HubSpot API over a private app token.", "A private app token.", ["crm.objects.contacts.read", "crm.objects.deals.write"]),
    integration("Stripe", "Finance", "Read balances and invoices", "Reads balance, payouts, and open invoices. Never charges.", "Stripe API over a restricted key.", "A restricted key with read-only scopes.", ["balance:read", "invoices:read"]),
    integration("X", "Marketing & Support", "Draft posts for approval", "Drafts posts and threads; publishing always asks.", "X API over OAuth 2.0.", "An app with write access.", ["tweet.read", "tweet.write"]),
    integration("YouTube", "Marketing & Support", "Read channel analytics", "Reads views and watch time for the last 28 days.", "YouTube Data API over OAuth.", "A Google account with a channel.", ["youtube.readonly"]),
    integration("Reddit", "Marketing & Support", "Watch a subreddit", "Reads new posts from three subreddits and ranks them.", "Reddit API over OAuth.", "An app id and secret.", ["read"]),
    integration("PostHog", "Analytics", "Query product analytics", "Runs saved insights and returns the series.", "PostHog API over a personal key.", "A personal API key and project id.", ["insight:read"]),
    integration("Postgres", "Other", "Read a database with SQL", "Runs read-only queries against one schema.", "A direct TCP connection from this machine.", "A connection string kept in the keychain.", ["select"]),
  ],
  automations: [
    {
      id: "a-morning",
      name: "Morning briefing",
      schedule: "0 8 * * 1-5",
      webhook: null,
      assignee: "Ash",
      prompt: "Summarise overnight changes, unread mail that matters, and the three things due today.",
      status: "running",
      runs: [
        { id: "r-1", at: ago(3 * HOUR), status: "ok", duration: "41 s" },
        { id: "r-2", at: ago(1 * DAY), status: "ok", duration: "38 s" },
        { id: "r-3", at: ago(2 * DAY), status: "failed", duration: "12 s" },
      ],
    },
    {
      id: "a-pr",
      name: "PR babysitter",
      schedule: null,
      webhook: "/hooks/github/pull_request",
      assignee: "Mira",
      prompt: "Read the diff, run the tests, and comment with anything that would block a merge.",
      status: "running",
      runs: [
        { id: "r-4", at: ago(52 * 60_000), status: "ok", duration: "2 m 04 s" },
        { id: "r-5", at: ago(6 * HOUR), status: "running", duration: "—" },
      ],
    },
    {
      id: "a-reading",
      name: "Weekly reading",
      schedule: "0 18 * * 5",
      webhook: null,
      assignee: "Ash",
      prompt: "Collect what I saved this week and write one page with the disagreements intact.",
      status: "paused",
      runs: [{ id: "r-6", at: ago(WEEK), status: "ok", duration: "1 m 12 s" }],
    },
  ],
  portals: [
    {
      id: "p-mira",
      partner: "Mira",
      email: "mira@example.studio",
      status: "synced",
      shared: [
        { id: "ps-1", name: "Product", rail: "#FF6D00", count: 2, on: true },
        { id: "ps-2", name: "Voice brief", rail: "#4FB3FF", count: 1, on: false },
      ],
      received: [{ id: "pr-1", name: "Studio references", rail: "#B36BFF", count: 14, on: true }],
      audit: [
        { id: "pa-1", at: ago(40 * 60_000), who: "Mira", what: "opened Product / World notes" },
        { id: "pa-2", at: ago(4 * HOUR), who: "You", what: "shared Voice brief" },
        { id: "pa-3", at: ago(1 * DAY), who: "Mira", what: "added 14 files to Studio references" },
      ],
    },
  ],
  market: [
    { id: "m-inbox", name: "Inbox Marshal", blurb: "Triage, draft, and file mail without opening a tab.", shelf: "Productivity", price: 12, state: "owned", does: "Sorts mail into reply, read, and archive, then drafts what needs you.", connects: "Gmail or Outlook.", needs: "One mail account; send always asks." },
    { id: "m-weekly", name: "Weekly Operator", blurb: "A Monday brief built from your calendar, repo, and ledger.", shelf: "Productivity", price: 9, state: "owned", does: "Writes one page every Monday morning and leaves it in Documents.", connects: "Calendar, GitHub, and this world's ledger.", needs: "At least one connected source." },
    { id: "m-deep", name: "Deep Research", blurb: "Five sources, one page, disagreements intact.", shelf: "Research", price: 18, state: "connect", does: "Runs a multi-source pass and keeps the citations.", connects: "Web search, Drive, and Notion.", needs: "A search key; read-only access to both libraries." },
    { id: "m-cite", name: "Citation Keeper", blurb: "Every claim gets a source or it gets cut.", shelf: "Research", price: null, state: "included", does: "Adds and checks citations in any document you write.", connects: "Nothing — it works on local text.", needs: "Nothing." },
    { id: "m-ship", name: "Ship It", blurb: "Open the PR, run the checks, and write the release note.", shelf: "Build", price: 24, state: "connect", does: "Turns a finished task into a pull request with a reviewable diff.", connects: "GitHub and Linear.", needs: "A fine-grained token and a repository you own." },
    { id: "m-tests", name: "Test Gardener", blurb: "Find the test that should exist, then write it.", shelf: "Build", price: 15, state: "owned", does: "Reads the diff and proposes the missing test before the merge.", connects: "Your workspace roots.", needs: "Write access to the repository." },
    { id: "m-studio", name: "Studio Floor", blurb: "A room for every project, with its own palette.", shelf: "Studio", price: null, state: "build", does: "Builds a separate world floor per project, with its own accent and orb set.", connects: "Nothing yet — it is designed with you.", needs: "A session with us; not sold as a download." },
    { id: "m-onboard", name: "Set-up and training", blurb: "Two hours with a human, and a world that fits how you work.", shelf: "Studio", price: null, state: "training", does: "We sit down with you, wire the first three automations, and leave notes.", connects: "Whatever you already use.", needs: "A booking." },
  ],
  library: [
    { id: "l-1", kind: "Generated", source: "Local", at: ago(9 * 60_000), status: "done", cost: 0.03, asked: "Summarise the three documents in Product.", done: "One page, with the disagreements between the two specs kept." },
    { id: "l-2", kind: "Uploaded", source: "Local", at: ago(2 * HOUR), status: "done", cost: 0, asked: "chrome-measurements.md", done: "Indexed, 11 tags." },
    { id: "l-3", kind: "Generated", source: "GitHub", at: ago(1 * DAY), status: "failed", cost: 0.01, asked: "Read the diff on opening-night and name the risky lines.", done: "GitHub returned 401 — the token has no repo scope." },
    { id: "l-4", kind: "Generated", source: "Drive", at: ago(2 * DAY), status: "running", cost: 0.02, asked: "Collect the studio references into one page.", done: "Reading 14 files." },
    { id: "l-5", kind: "Uploaded", source: "Notion", at: ago(2 * WEEK), status: "done", cost: 0, asked: "Ship checklist", done: "Exported as markdown." },
  ],
  goals: [
    { id: "g-1", title: "Ship the parity build", status: "working", progress: 0.72, agentId: "" },
    { id: "g-2", title: "Keep the ledger under a thousand rows", status: "open", progress: 0.31, agentId: "" },
    { id: "g-3", title: "Read the three books on the shelf", status: "done", progress: 1, agentId: "" },
  ],
};

const KEY = "vivarium.local.v3";

function read(): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(SEED);
    const parsed = JSON.parse(raw) as Partial<Db>;
    return { ...structuredClone(SEED), ...parsed };
  } catch {
    return structuredClone(SEED);
  }
}

let db: Db = read();
const listeners = new Set<(next: Db) => void>();

export function getDb(): Db {
  return db;
}

export function setDb(next: Db) {
  db = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn(db);
}

export function updateDb(fn: (prev: Db) => Db) {
  setDb(fn(db));
}

export function resetDb() {
  db = structuredClone(SEED);
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn(db);
}

export function useDb(): [Db, (fn: (prev: Db) => Db) => void] {
  const [snap, setSnap] = useState<Db>(db);
  useEffect(() => {
    const fn = (next: Db) => setSnap(next);
    listeners.add(fn);
    setSnap(db);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return [snap, updateDb];
}
