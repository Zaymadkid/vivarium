import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentRecord, AuditEntry, Settings } from "../../shared/types";
import ChatDock from "./ChatDock";
import World from "./World";
import { SectionBody, SECTIONS } from "./Panels";
import { Icon } from "./shell/icons";
import { ItemLogo } from "./shell/logo";
import { TopBar } from "./shell/TopBar";
import { NavBar, type NavItem } from "./shell/NavBar";
import { Palette, type PaletteRow } from "./shell/Palette";
import { Console } from "./shell/Console";
import { ApprovalStack } from "./shell/Approvals";
import { VoicePill } from "./shell/VoicePill";
import { FileViewer } from "./shell/FileViewer";
import { ToastHost, pushToast } from "./shell/toasts";
import {
  GettingStartedPanel,
  HelpTour,
  type Step,
  type Notice,
} from "./shell/Menus";
import { useDb } from "./shell/data";
import { formatDate, usePrefs } from "./shell/prefs";
import { Dot, Empty } from "./shell/ui";
import { DocumentsScreen } from "./screens/Documents";
import { SkillsScreen } from "./screens/Skills";
import { IntegrationsScreen } from "./screens/Integrations";
import { AutomationsScreen } from "./screens/Automations";
import { LiveScreen } from "./screens/Live";
import { ScreenScreen } from "./screens/Screen";
import { PortalsScreen } from "./screens/Portals";
import { MarketplaceScreen } from "./screens/Marketplace";
import { CreditsScreen } from "./screens/Credits";
import { SettingsWindow } from "./shell/SettingsWindow";
import { Swarm } from "./shell/Swarm";
import { DashboardScreen } from "./screens/Dashboard";
import { CalendarScreen } from "./screens/Calendar";
import { TeamScreen } from "./screens/Team";
import { ToolsScreen } from "./screens/Tools";
import { BrainScreen } from "./screens/Brain";

type Route =
  | "world"
  | "dashboard"
  | "calendar"
  | "documents"
  | "skills"
  | "integrations"
  | "automations"
  | "live"
  | "screen"
  | "portals"
  | "team"
  | "tools"
  | "marketplace"
  | "settings"
  | "credits"
  | "brain";

type Drawer = null | "console" | "configure";

const NAV: { id: Route; label: string }[] = [
  { id: "world", label: "World" },
  { id: "dashboard", label: "Dashboard" },
  { id: "documents", label: "Documents" },
  { id: "calendar", label: "Calendar" },
  { id: "skills", label: "Skills" },
  { id: "integrations", label: "Integrations" },
  { id: "automations", label: "Automations" },
  { id: "live", label: "Live call" },
  { id: "screen", label: "Screen" },
  { id: "portals", label: "Portals" },
  { id: "tools", label: "Tools" },
  { id: "team", label: "Team" },
  { id: "settings", label: "Settings" },
  { id: "marketplace", label: "Marketplace" },
];

/**
 * The stage carousel. Arrow keys walk it left and right, with the dots sitting
 * under the world: World → Brain → the working screens. Settings is a window,
 * not a stop, so it is not in the ring.
 */
const SCREENS: Route[] = [
  "world",
  "brain",
  "dashboard",
  "calendar",
  "documents",
  "skills",
  "integrations",
  "automations",
  "live",
  "screen",
  "portals",
  "tools",
  "team",
  "marketplace",
  "credits",
];

/** Her accent as a hue, for Settings → Companion → Colour → Workers. */
function hueOf(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 154;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 32;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const deg = h * 60;
  return deg < 0 ? deg + 360 : deg;
}

const ROUTE_TITLE: Record<Route, string> = {
  world: "World",
  dashboard: "Dashboard",
  calendar: "Calendar",
  team: "Team",
  tools: "Tools",
  documents: "Documents",
  skills: "Skills",
  integrations: "Integrations",
  automations: "Automations",
  live: "Live call",
  screen: "Screen",
  portals: "Portals",
  marketplace: "Marketplace",
  settings: "Settings",
  credits: "Ledger",
  brain: "Brain",
};

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [selected, setSelected] = useState("");
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [info, setInfo] = useState<{ version: string; platform: string; dataDir: string } | null>(null);
  const [prefs, setPrefs] = usePrefs();
  const [db] = useDb();

  const [route, setRoute] = useState<Route>("world");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [startedOpen, setStartedOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [drawerSection, setDrawerSection] = useState("prefs");
  const [swapDir, setSwapDir] = useState<1 | -1>(1);
  const [placesOpen, setPlacesOpen] = useState(false);
  const [summoning, setSummoning] = useState<{ id: string; name: string } | null>(null);
  // `undefined` = closed; `null` = open on the list; a string = open on that file.
  const [fileView, setFileView] = useState<string | null | undefined>(undefined);
  const [voiceSeed, setVoiceSeed] = useState<{ text: string; at: number; send?: boolean } | null>(null);
  // Push-to-talk is a hold, not a toggle. A quick tap leaves the pill open for
  // a long thought; holding the key and letting go sends the turn.
  const voiceOpenRef = useRef(false);
  voiceOpenRef.current = voiceOpen;
  const voicePressedAt = useRef(0);
  const voiceWasOpen = useRef(false);

  const reloadSettings = useCallback(() => {
    void window.viv.settings.get().then(setSettings);
  }, []);

  const knownAgents = useRef<Set<string>>(new Set());
  const reloadAgents = useCallback(() => {
    void window.viv.agents.list().then((list) => {
      // A worker that was not here a moment ago is being summoned: the arrival
      // animation belongs to `bot_spawned`, not to a permanent companion.
      const born = list.find((a) => !knownAgents.current.has(a.id) && a.agentType === "bot");
      knownAgents.current = new Set(list.map((a) => a.id));
      if (born) {
        setSummoning({ id: born.id, name: born.name });
        window.setTimeout(() => setSummoning(null), 1800);
      }
      setAgents(list);
      setSelected((current) => current || list[0]?.id || "");
    });
  }, []);

  useEffect(() => {
    // Workers are spawned and killed by `delegate_task` during a run; the only
    // way the world learns about them is the runtime's own state events.
    return window.viv.chat.onEvent((event) => {
      if (event.type === "agent-state") reloadAgents();
      if (event.type === "dispatch") {
        reloadAgents();
        // A new orb grows along a thread when work is handed over; `bornId` is
        // the animation that introduces it.
        setSummoning({ id: event.agentId, name: event.agentName });
        window.setTimeout(() => {
          setSummoning((current) => (current?.id === event.agentId ? null : current));
        }, 1600);
      }
    });
  }, [reloadAgents]);

  // A "view file" anywhere in the app raises one event; the viewer is mounted once.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string }>).detail;
      setFileView(detail?.path ?? null);
    };
    window.addEventListener("viv:open-file", onOpen);
    return () => window.removeEventListener("viv:open-file", onOpen);
  }, []);

  // Transcribed speech goes into the composer, not straight to the model.
  useEffect(() => {
    const onHeard = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; send?: boolean }>).detail;
      const text = detail?.text?.trim();
      if (!text) return;
      setVoiceOpen(false);
      setChatOpen(true);
      setVoiceSeed({ text, at: Date.now(), send: detail?.send });
    };
    window.addEventListener("viv:voice-text", onHeard);
    return () => window.removeEventListener("viv:voice-text", onHeard);
  }, []);

  const reloadAudit = useCallback(() => {
    void window.viv.audit.list().then((rows) => setAudit(rows));
  }, []);

  useEffect(() => {
    void window.viv.info().then(setInfo);
    reloadSettings();
    reloadAgents();
    reloadAudit();
  }, [reloadSettings, reloadAgents, reloadAudit]);

  useEffect(() => {
    const id = window.setInterval(reloadAudit, 8000);
    return () => window.clearInterval(id);
  }, [reloadAudit]);

  useEffect(() => {
    if (!settings) return;
    // Her colour belongs to the world (the orb and the sea); the chrome keeps a
    // fixed warm accent so every tab reads the same.
    document.documentElement.style.setProperty("--companion", settings.accent);
    document.documentElement.dataset.motion = settings.reducedMotion ? "reduced" : "full";
  }, [settings]);

  // Settings → Companion / Preferences / Abilities are the renderer's, but the
  // model and the tool gate live in the main process. Mirror the parts that matter so
  // a toggle changes behaviour, not just a value in localStorage. The name is
  // resolved from the list here because this effect runs before `agent` exists.
  const runtimeName = agents.find((a) => a.id === selected)?.name ?? agents[0]?.name ?? "";
  const runtimeKey = JSON.stringify([
    runtimeName,
    prefs.preamble,
    prefs.personality,
    prefs.tone,
    prefs.proactivity,
    prefs.goal,
    prefs.interview,
    prefs.autoEveryday,
    prefs.autoBuild,
    prefs.autoDestroy,
    prefs.allowShell,
    prefs.allowWrite,
    prefs.allowNetwork,
    prefs.readOutsideRoots,
    prefs.screenAccess,
    prefs.desktopControl,
    prefs.islandMode,
    prefs.autoMemory,
    prefs.autoSkills,
    prefs.notifDevices,
    prefs.accountName,
    prefs.accountEmail,
  ]);
  const syncedRuntime = useRef("");
  useEffect(() => {
    if (syncedRuntime.current === runtimeKey) return;
    syncedRuntime.current = runtimeKey;
    void window.viv.settings.set({
      persona: {
        name: runtimeName,
        preamble: prefs.preamble,
        personality: prefs.personality,
        tone: prefs.tone,
        proactivity: prefs.proactivity,
        goal: prefs.goal,
        interview: prefs.interview,
      },
      autonomy: { everyday: prefs.autoEveryday, build: prefs.autoBuild, destroy: prefs.autoDestroy },
      abilities: {
        shell: prefs.allowShell,
        write: prefs.allowWrite,
        network: prefs.allowNetwork,
        readOutside: prefs.readOutsideRoots,
        screen: prefs.screenAccess,
        hands: prefs.desktopControl,
      },
      learning: { memory: prefs.autoMemory, skills: prefs.autoSkills },
      island: prefs.islandMode,
      notifyOs: prefs.notifDevices,
      you: {
        // "You" is the placeholder, not a name; do not greet someone as "You".
        name: /^you$/i.test(prefs.accountName.trim()) ? "" : prefs.accountName.trim(),
        email: prefs.accountEmail.trim(),
      },
    });
    // The key above is the dependency: one write per actual change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeKey]);

  useEffect(() => {
    const start = prefs.startView;
    if (start === "documents") setRoute("documents");
    if (start === "configure") setDrawer("configure");
    // Only on first mount: `startView` is an opening position, not a route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = useCallback((next: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...next } : s));
    void window.viv.settings.set(next).then(setSettings);
  }, []);

  const agent = useMemo(() => agents.find((a) => a.id === selected) ?? agents[0], [agents, selected]);
  const index = Math.max(0, agents.findIndex((a) => a.id === agent?.id));
  // Settings → Companion → Colour → Workers: workers keep their own hue, or all
  // take hers. This is a display choice; the stored records are untouched.
  const paintedAgents = useMemo(
    () =>
      prefs.workerColour === "companion"
        ? agents.map((a) => ({ ...a, hue: hueOf(settings?.accent ?? "#35E29B") }))
        : agents,
    [agents, prefs.workerColour, settings?.accent],
  );

  const step = useCallback(
    (delta: number) => {
      if (agents.length === 0) return;
      const next = (index + delta + agents.length) % agents.length;
      setSwapDir(delta > 0 ? 1 : -1);
      setSelected(agents[next].id);
    },
    [agents, index],
  );

  const renameAgent = useCallback(
    async (name: string) => {
      if (!agent) return;
      const list = await window.viv.agents.save(agents.map((a) => (a.id === agent.id ? { ...a, name } : a)));
      setAgents(list);
      pushToast({ title: "Renamed", body: name, tone: "ok" });
    },
    [agent, agents],
  );

  const open = useCallback((id: string) => {
    if (id === "configure") {
      setDrawer("configure");
      return;
    }
    setDrawer(null);
    setRoute(id as Route);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (meta && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setChatOpen((v) => !v);
        return;
      }
      if (meta && e.key === ".") {
        e.preventDefault();
        setDrawer((d) => (d === "console" ? null : "console"));
        return;
      }
      if (typing) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (e.repeat) return;
        // A second press while the pill is open is the stop press; the release
        // below finishes the clip. A first press only opens the microphone.
        voicePressedAt.current = Date.now();
        voiceWasOpen.current = voiceOpenRef.current;
        if (!voiceOpenRef.current) setVoiceOpen(true);
        return;
      }
      // The brain canvas owns the arrows while it has focus (it pans its
      // constellation by 40 px), so respect its default.
      if (e.defaultPrevented) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setRoute((current) => {
          const at = SCREENS.indexOf(current);
          const from = at === -1 ? 0 : at;
          const next = (from + (e.key === "ArrowRight" ? 1 : -1) + SCREENS.length) % SCREENS.length;
          return SCREENS[next];
        });
        setDrawer(null);
        return;
      }
      if (e.key === "ArrowUp") step(-1);
      if (e.key === "ArrowDown") step(1);
      if (e.key === "Escape") {
        setPaletteOpen(false);
        setDrawer(null);
        setChatOpen(false);
        setVoiceOpen(false);
        setRoute("world");
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !voicePressedAt.current) return;
      const held = Date.now() - voicePressedAt.current;
      const wasOpen = voiceWasOpen.current;
      voicePressedAt.current = 0;
      voiceWasOpen.current = false;
      // Hold-to-talk ends on release. A quick tap leaves the pill listening so
      // a long answer can be given without holding the key down.
      if (held >= 350 || wasOpen) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("viv:voice-finish"));
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
  }, [step]);

  const notices: Notice[] = useMemo(
    () =>
      audit
        .slice(-3)
        .reverse()
        .map((row, i) => ({
          id: `${row.at}-${i}`,
          title: row.summary || row.tool,
          body: row.ok ? "Finished cleanly." : "Failed — open the ledger.",
          at: formatDate(row.at, prefs.locale),
          tone: row.ok ? "ok" : "bad",
        })),
    [audit, prefs.locale],
  );

  const paletteRows: PaletteRow[] = useMemo(() => {
    const destinations: PaletteRow[] = [
      ...NAV,
      { id: "credits", label: "Ledger", group: "Destinations", icon: "receipt", run: () => open("credits") },
    ].map((item) => ({
      id: `nav-${item.id}`,
      label: item.label,
      group: "Destinations",
      icon: "target" as const,
      hint: "⌘↵",
      run: () => open(item.id),
    }));

    const people: PaletteRow[] = agents.map((a) => ({
      id: `agent-${a.id}`,
      label: a.name,
      group: "Companions",
      icon: "user" as const,
      hint: a.state,
      run: () => {
        setSelected(a.id);
        setChatOpen(true);
      },
    }));

    const actions: PaletteRow[] = [
      {
        id: "act-chat",
        label: "Open the chat drawer",
        group: "Actions",
        icon: "spark",
        hint: "⌘J",
        run: () => setChatOpen(true),
      },
      {
        id: "act-console",
        label: "Open the console",
        group: "Actions",
        icon: "bolt",
        hint: "⌘.",
        run: () => setDrawer("console"),
      },
      {
        id: "act-doc",
        label: "New document",
        group: "Actions",
        icon: "doc",
        run: () => open("documents"),
      },
      {
        id: "act-voice",
        label: "Push to talk",
        group: "Actions",
        icon: "mic",
        hint: "Space",
        run: () => setVoiceOpen(true),
      },
      {
        id: "act-settings",
        label: "Open settings",
        group: "Actions",
        icon: "gear",
        run: () => open("settings"),
      },
    ];

    return [...destinations, ...people, ...actions];
  }, [agents, open]);

  const steps: Step[] = useMemo(
    () => [
      {
        id: "mind",
        label: "Choose where she thinks",
        done: !!settings && settings.provider !== "mock",
        run: () => open("settings"),
      },
      {
        id: "doc",
        label: "Write one document",
        done: db.docs.some((d) => d.body.trim().length > 0),
        run: () => open("documents"),
      },
      {
        id: "skill",
        label: "Make a skill",
        done: db.skills.some((s) => s.status === "ready"),
        run: () => open("skills"),
      },
      {
        id: "plug",
        label: "Connect one integration",
        done: db.integrations.some((i) => i.status === "connected"),
        run: () => open("integrations"),
      },
    ],
    [settings, db, open],
  );

  if (!settings) {
    return (
      <div className="boot">
        <span className="boot-orb" />
        <span>waking her memory…</span>
      </div>
    );
  }

  const navActive: string = route === "world" ? (drawer === "console" ? "console" : drawer === "configure" ? "configure" : "world") : route;

  return (
    <div className="app">
      <TopBar
        onSearch={() => setPaletteOpen(true)}
        notices={notices}
        unread={notices.filter((n) => n.tone === "bad").length}
        locale={prefs.locale}
        onLocale={(value) => setPrefs({ locale: value })}
        accountName={prefs.accountName || "You"}
        accountEmail={prefs.accountEmail}
        onSettings={() => open("settings")}
        onGettingStarted={() => setStartedOpen(true)}
        onTour={() => setTourOpen(true)}
        onLogOut={() =>
          pushToast({
            title: "There is no account to leave",
            body: "This world lives on this machine.",
            tone: "info",
          })
        }
        onOpenLedger={() => open("credits")}
        onPlaces={() => setPlacesOpen((v) => !v)}
        onOverlay={() => void window.viv.overlay.show()}
        onHome={() => {
          setRoute("world");
          setDrawer(null);
          setPlacesOpen(false);
        }}
      />

      <main className="stage">
        <World
          agent={agent}
          accent={settings.accent}
          reducedMotion={settings.reducedMotion}
          look={{ quality: prefs.renderQuality, bloom: prefs.bloom, drift: prefs.ambientDrift }}
        />

        <Swarm
          agents={paintedAgents}
          activeId={agent?.id}
          bornId={summoning?.id ?? null}
          onSelect={(id) => {
            setSelected(id);
            setSwapDir(1);
            // A worker's orb is a door into its own conversation.
            setChatOpen(true);
          }}
        />

        <button
          className={`voice-hint ${route === "brain" ? "on-brain" : ""}`}
          onClick={() => setVoiceOpen(true)}
          title="Hold Space to talk"
        >
          <i className="voice-hint-dot" />
          Hold Space to talk
        </button>

        <button
          className={`side-toggle ${chatOpen ? "on" : ""}`}
          onClick={() => setChatOpen((v) => !v)}
          aria-label={chatOpen ? "Close the conversation" : "Open the conversation"}
          title={chatOpen ? "Close the conversation" : "Talk to her"}
        >
          <Icon name={chatOpen ? "close" : "left"} size={15} />
        </button>

        {route !== "brain" && (
        <button className="started-pill" onClick={() => setStartedOpen(true)}>
          <b>
            {steps.filter((s) => s.done).length}
            <i>/{steps.length}</i>
          </b>
          <span>Getting started</span>
          <em>
            {steps.filter((s) => !s.done).length} left
          </em>
        </button>
        )}

        {route !== "world" && route !== "brain" && route !== "settings" && (
          <div className="screen-overlay" role="region" aria-label={ROUTE_TITLE[route]}>
            <div className="screen-overlay-bar">
              <button className="btn sm ghost" onClick={() => setRoute("world")}>
                <Icon name="left" size={12} />
                World
              </button>
              <span className="crumb">{ROUTE_TITLE[route]}</span>
              <button className="icon-btn sm" onClick={() => setRoute("world")} aria-label="Close">
                <Icon name="close" size={13} />
              </button>
            </div>

            {route === "dashboard" && <DashboardScreen agents={paintedAgents} onOpen={open} />}
            {route === "calendar" && <CalendarScreen />}
            {route === "team" && <TeamScreen />}
            {route === "tools" && <ToolsScreen />}
            {route === "documents" && <DocumentsScreen onTalk={() => setChatOpen(true)} />}
            {route === "skills" && <SkillsScreen onOpen={open} />}
            {route === "integrations" && <IntegrationsScreen onOpen={open} />}
            {route === "automations" && <AutomationsScreen />}
            {route === "live" && <LiveScreen agentId={selected || agents[0]?.id || ""} />}
            {route === "screen" && <ScreenScreen onOpen={open} />}
            {route === "portals" && <PortalsScreen />}
            {route === "marketplace" && <MarketplaceScreen onOpen={open} />}
            {route === "credits" && <CreditsScreen onOpen={open} />}
          </div>
        )}

        {route === "settings" && (
          <SettingsWindow
            settings={settings}
            patch={patch}
            info={info}
            agentName={agent?.name ?? ""}
            onRenameAgent={(name) => void renameAgent(name)}
            onClose={() => setRoute("world")}
            onOpen={open}
            onRefresh={() => {
              reloadSettings();
              reloadAgents();
              reloadAudit();
            }}
          />
        )}

        {drawer === "console" && (
          <aside className="drawer left" aria-label="Console">
            <header className="drawer-head">
              <Dot tone="live" pulse />
              <h2>Console</h2>
              <button className="drawer-x" onClick={() => setDrawer(null)} aria-label="Close console">
                <Icon name="close" size={14} />
              </button>
            </header>
            <div className="drawer-body">
              <Console
                agents={paintedAgents}
                selectedId={selected}
                audit={audit}
                onSelect={setSelected}
                onTalk={(id) => {
                  setSelected(id);
                  setChatOpen(true);
                }}
                onVoice={() => setVoiceOpen(true)}
                onOpen={(id) => {
                  if (id === "prefs") {
                    setDrawer("configure");
                    return;
                  }
                  open(id);
                }}
              />
            </div>
          </aside>
        )}

        {drawer === "configure" && (
          <aside className="drawer left" aria-label="Configure">
            <header className="drawer-head">
              <Dot tone="live" />
              <h2>Configure</h2>
              <button className="drawer-x" onClick={() => setDrawer(null)} aria-label="Close configure">
                <Icon name="close" size={14} />
              </button>
            </header>
            <div className="drawer-body">
              <div className="drawer-settings">
                <nav className="drawer-rail" aria-label="Settings sections">
                  {SECTIONS.map((s) => (
                    <button
                      key={s.id}
                      className={`drawer-rail-row ${drawerSection === s.id ? "on" : ""}`}
                      onClick={() => setDrawerSection(s.id)}
                      title={`${s.title} — ${s.blurb}`}
                      aria-label={s.title}
                      aria-current={drawerSection === s.id ? "page" : undefined}
                    >
                      <Icon name={s.icon} size={14} />
                    </button>
                  ))}
                </nav>
                <div className="drawer-pane">
                <SectionBody
                  id={drawerSection}
                  props={{
                    settings,
                    patch,
                    compact: true,
                    info,
                    agentName: agent?.name ?? "",
                    onRenameAgent: (name) => void renameAgent(name),
                    onOpen: (id) => setDrawerSection(id === "prefs" ? "prefs" : id),
                    onRefresh: reloadSettings,
                  }}
                />
                </div>
              </div>
              <button className="footer-link wide" onClick={() => open("settings")}>
                Open the full settings page
                <Icon name="right" size={12} />
              </button>
            </div>
          </aside>
        )}

        {route !== "brain" && <div className="bottom-stack">
          <NavBar
            items={
              [
                { id: "chat", label: "Chat" },
                { id: "console", label: "Console" },
                { id: "configure", label: "Configure" },
              ] as NavItem[]
            }
            active={["chat", ...(drawer ? [drawer] : navActive && navActive !== "world" && navActive !== "chat" ? [navActive] : [])]}
            onPick={(id) => {
              if (id === "chat") {
                setChatOpen((v) => !v);
                return;
              }
              if (id === "console") {
                setDrawer((d) => (d === "console" ? null : "console"));
                setRoute("world");
                return;
              }
              if (id === "configure") {
                setDrawer((d) => (d === "configure" ? null : "configure"));
                setRoute("world");
                return;
              }
              setDrawer(null);
              setRoute(id as Route);
            }}
            entries={audit.length}
            onLedger={() => open("credits")}
            ledgerActive={route === "credits"}
          />
          <p className="hint">
            Chat · Console · Configure — tap an item to open or close it · the ledger on the right
          </p>

          <div className="carousel-block" data-dir={swapDir > 0 ? "next" : "prev"}>
            <div className="carousel-row">
              <button
                className="carousel-arrow"
                onClick={() => step(-1)}
                disabled={agents.length < 2}
                aria-label="Previous companion"
              >
                <Icon name="left" size={16} />
              </button>
              <div className="carousel-centre">
                <span className="carousel-name" key={agent?.id ?? "none"}>
                  {agent?.name ?? "no one yet"}
                </span>
                <span className="carousel-role">
                  {index === 0 ? "orchestrator · the voice of your world" : "worker in this world"}
                </span>
              </div>
              <button
                className="carousel-arrow"
                onClick={() => step(1)}
                disabled={agents.length < 2}
                aria-label="Next companion"
              >
                <Icon name="right" size={16} />
              </button>
            </div>
            <div className="dots">
              {agents.map((a) => (
                <button
                  key={a.id}
                  className={`dotbtn ${a.id === agent?.id ? "on" : ""}`}
                  onClick={() => {
                    const target = agents.findIndex((x) => x.id === a.id);
                    setSwapDir(target > index ? 1 : -1);
                    setSelected(a.id);
                  }}
                  aria-label={a.name}
                  title={a.name}
                />
              ))}
            </div>
          </div>
        </div>}

        {route === "brain" && (
          <BrainScreen
            onOpenDocuments={() => open("documents")}
            onWorld={() => setRoute("world")}
            page={Math.max(0, SCREENS.indexOf(route))}
            onGo={(i) => {
              const next = SCREENS[i];
              if (next) setRoute(next);
            }}
            onPrev={() =>
              setRoute((current) => {
                const at = Math.max(0, SCREENS.indexOf(current));
                return SCREENS[(at - 1 + SCREENS.length) % SCREENS.length];
              })
            }
            onNext={() =>
              setRoute((current) => {
                const at = Math.max(0, SCREENS.indexOf(current));
                return SCREENS[(at + 1) % SCREENS.length];
              })
            }
          />
        )}

        {startedOpen && <GettingStartedPanel steps={steps} onClose={() => setStartedOpen(false)} />}

        {db.docs.length === 0 && route === "world" && (
          <div className="world-hint">
            <Empty
              tight
              icon="spark"
              title="Nothing in this world yet"
              body="Start with a document, or ask her to write one."
              action={
                <button className="btn sm primary" onClick={() => open("documents")}>
                  Open Documents
                </button>
              }
            />
          </div>
        )}
      </main>

      {placesOpen && (
        <>
          <button className="places-scrim" aria-label="Close places" onClick={() => setPlacesOpen(false)} />
          <div className="places-panel" role="dialog" aria-label="Places in this world">
            <header className="places-head">
              <span>Places</span>
              <kbd className="kbd">⌘K</kbd>
            </header>
            <div className="places-grid">
              {([...NAV, { id: "brain", label: "Brain" }, { id: "credits", label: "Ledger" }, { id: "configure", label: "Configure" }] as {
                id: string;
                label: string;
              }[]).map((item) => (
                <button
                  key={item.id}
                  className="place-card"
                  onClick={() => {
                    setPlacesOpen(false);
                    open(item.id);
                  }}
                >
                  <ItemLogo id={item.id} label={item.label} size={26} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {chatOpen && (
        <ChatDock
          agents={agents}
          selectedId={selected}
          onSelect={setSelected}
          onAgentsChanged={reloadAgents}
          onClose={() => setChatOpen(false)}
          onOpenDocuments={() => setRoute("documents")}
          seed={voiceSeed}
          onSeedHandled={() => setVoiceSeed(null)}
        />
      )}

      <ApprovalStack hidden={chatOpen} />
      <VoicePill open={voiceOpen} onClose={() => setVoiceOpen(false)} />
      {fileView !== undefined && (
        <FileViewer initialPath={fileView ?? undefined} onClose={() => setFileView(undefined)} />
      )}
      {paletteOpen && <Palette rows={paletteRows} onClose={() => setPaletteOpen(false)} />}
      {tourOpen && <HelpTour onClose={() => setTourOpen(false)} />}
      <ToastHost />
    </div>
  );
}
