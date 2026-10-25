import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Notification,
  screen,
  session,
  shell,
} from "electron";
import { execFile, spawn } from "node:child_process";
import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Runtime } from "./agent";
import { installCliBridge } from "./cli-bridge";
import { startAppBridge, type AppBridge } from "./app-bridge";
import { clickAt, handsReady, installHands, listWindows, pressKeys, typeText } from "./hands";
import { HookBridge } from "./hookbridge";
import { scanIntegrations } from "./integrations";
import { fireRoutine, observeRoutineRun, startScheduler } from "./scheduler";
import { captureScreen } from "./screen";
import { neuralSpeech, warmNeuralVoice } from "./neural-voice";
import { runVoiceAction } from "./voice-actions";
import { configureStt, installStt, sttStatus, sweepStt, transcribeLocal } from "./stt";
import { Store } from "./store";
import { Vault } from "./vault";
import { destroyGuide, guideStatus, hideGuide, showGuide, stepGuide } from "./guide";
import type {
  AgentRecord,
  AgentState,
  FileNode,
  FilePreview,
  GuidePayload,
  Settings,
  SkillRecord,
} from "../shared/types";

// Windows often advertises an IPv6 route it cannot actually use. Every network
// call in this process, the voice included, prefers IPv4 instead of waiting out
// an unreachable address first.
dns.setDefaultResultOrder("ipv4first");
// Node gives each address 250 ms in its happy-eyeballs race. On a machine with a
// dead IPv6 route that is not enough time for the IPv4 connection to answer, so
// the race reports ETIMEDOUT on a network that is plainly working. Give IPv4 a
// real window; a healthy connection still wins in milliseconds.
net.setDefaultAutoSelectFamilyAttemptTimeout(4_000);

/** Directories that are never worth listing in a preview: build output, deps, VCS. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "out", "dist", "build", ".next", ".cache", ".venv", "venv", "__pycache__"]);

/** True when `target` is `root` or lives under it. */
function under(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Resolve a path and prove it is still inside an allowed root after symlinks. */
function resolveInRoots(input: string, roots: string[]): string | null {
  if (!input) return null;
  const raw = path.resolve(input);
  let real = raw;
  try {
    real = fs.realpathSync.native(raw);
  } catch {
    real = path.join(fs.realpathSync.native(path.dirname(raw)), path.basename(raw));
  }
  return roots.some((r) => under(path.resolve(r), real)) ? real : null;
}

/**
 * A shallow walk of every folder the person allowed. Depth and count are capped
 * because this feeds a side panel, not a file manager.
 */
function listFiles(roots: string[], limit = 600): FileNode[] {
  const out: FileNode[] = [];
  const walk = (dir: string, root: string, depth: number) => {
    if (out.length >= limit || depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, root, depth + 1);
        continue;
      }
      let size = 0;
      let at = Date.now();
      try {
        const stat = fs.statSync(abs);
        size = stat.size;
        at = stat.mtimeMs;
      } catch {
        continue;
      }
      out.push({ path: abs, name: entry.name, dir: path.relative(root, dir) || ".", root, size, at });
    }
  };
  for (const root of roots) walk(path.resolve(root), path.resolve(root), 0);
  return out.sort((a, b) => b.at - a.at);
}

let win: BrowserWindow | null = null;
let overlayWin: BrowserWindow | null = null;
let quitting = false;
let store: Store;
let vault: Vault;
let appBridge: AppBridge | null = null;
let runtime: Runtime;
let hooks: HookBridge;

const OVERLAY_SHORTCUT = "CommandOrControl+Shift+Space";
const POINT_SHORTCUT = "CommandOrControl+Shift+T";
const ORB_WIDTH = 96;
const ORB_HEIGHT = 118;
const PANEL_WIDTH = 396;
const PANEL_HEIGHT = 620;
const ISLAND_WIDTH = 470;
const ISLAND_HEIGHT = 58;

/** One renderer build, two routes: the world and the on-screen Knot. */
function loadRenderer(target: BrowserWindow, hash?: string) {
  if (process.env.ELECTRON_RENDERER_URL) {
    void target.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash ? `#${hash}` : ""}`);
  } else {
    void target.loadFile(
      path.join(__dirname, "../renderer/index.html"),
      hash ? { hash } : undefined,
    );
  }
}

function createWindow() {
  // Live call hears what the machine plays. A loopback source is shared without
  // a picker, and the screen track is stopped by the renderer straight away; the
  // microphone is never part of this stream.
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      void desktopCapturer
        .getSources({ types: ["screen"], thumbnailSize: { width: 16, height: 16 } })
        .then((sources) => {
          // Two callers share this: a live call wants the machine's sound, the
          // Screen screen wants the picture. Give each only what it asked for.
          const primary = screen.getPrimaryDisplay();
          const video = request.videoRequested
            ? sources.find((source) => source.display_id === String(primary.id)) ?? sources[0]
            : undefined;
          callback({
            video,
            audio: request.audioRequested ? "loopback" : undefined,
          });
        })
        .catch(() => callback({ video: undefined, audio: undefined }));
    },
    { useSystemPicker: false },
  );
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: "#06080C",
    autoHideMenuBar: true,
    title: "Vivarium",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      // the world is a live render loop; never let Chromium park it in the background
      backgroundThrottling: false,
    },
  });

  win.once("ready-to-show", () => win?.show());
  // The world is the app's main window. Closing it closes the whole app, not
  // just itself while the Knot keeps a process alive in the background.
  win.on("closed", () => {
    win = null;
    overlayWin?.destroy();
    overlayWin = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://localhost") && !url.startsWith("file://")) event.preventDefault();
  });

  loadRenderer(win);
}

/**
 * THE KNOT.
 *
 * Nus' defining surface: a frameless, always-on-top window that is one keystroke
 * from listening. It shares the runtime, conversation, memory and approval stack
 * with the world window — it is a second view, not a second app. It starts
 * collapsed as an orb in the top-right corner and resizes itself when opened.
 */
function createOverlay(): BrowserWindow {
  if (overlayWin) return overlayWin;
  const area = screen.getPrimaryDisplay().workArea;
  const knot = new BrowserWindow({
    width: ORB_WIDTH,
    height: ORB_HEIGHT,
    x: area.x + area.width - ORB_WIDTH - 26,
    y: area.y + 26,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: "Vivarium Knot",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });
  overlayWin = knot;
  knot.setAlwaysOnTop(true, "screen-saver");
  knot.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  knot.once("ready-to-show", () => knot.showInactive());
  knot.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    knot.hide();
  });
  knot.on("closed", () => {
    if (overlayWin === knot) overlayWin = null;
  });
  knot.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  knot.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://localhost") && !url.startsWith("file://")) event.preventDefault();
  });
  loadRenderer(knot, "overlay");
  return knot;
}

function showOverlay(talk = false, focus = true) {
  const knot = overlayWin ?? createOverlay();
  const reveal = () => {
    knot.show();
    // Point-and-ask answers without taking the keyboard away from the app the
    // person is pointing at; the talk key still focuses the companion.
    if (focus) knot.focus();
    // The renderer attaches its talk listener in an effect after React mounts.
    // Give it a beat so the first hotkey press is not swallowed.
    if (talk) setTimeout(() => knot.webContents.send("viv:overlay:talk"), 180);
  };
  if (knot.webContents.isLoading()) {
    knot.webContents.once("did-finish-load", reveal);
  } else {
    reveal();
  }
}

function toggleOverlay(): boolean {
  if (!overlayWin) {
    showOverlay();
    return true;
  }
  if (overlayWin.isVisible()) {
    overlayWin.hide();
    return false;
  }
  showOverlay();
  return true;
}

function resizeOverlay(width: number, height: number) {
  if (!overlayWin) return;
  const w = Math.max(ORB_WIDTH, Math.min(520, Math.round(width || ORB_WIDTH)));
  const h = Math.max(ISLAND_HEIGHT, Math.min(760, Math.round(height || ORB_HEIGHT)));
  const bounds = overlayWin.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - w);
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - h);
  overlayWin.setBounds({ x, y, width: w, height: h }, true);
}

/**
 * ISLAND MODE.
 *
 * The Knot on its own is a warm orange orb in the corner; Nus offers a second
 * shape, a slim bar across the top of the screen. In island mode the window is
 * repositioned and resized, not recreated, so the same thread and microphone
 * survive the switch.
 */
function applyIsland(on: boolean) {
  if (!overlayWin) return;
  const bounds = overlayWin.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  if (on) {
    const width = Math.min(ISLAND_WIDTH, Math.max(360, area.width - 40));
    overlayWin.setBounds(
      {
        x: area.x + Math.round((area.width - width) / 2),
        y: area.y + 8,
        width,
        height: ISLAND_HEIGHT,
      },
      true,
    );
  } else {
    overlayWin.setBounds(
      {
        x: area.x + area.width - ORB_WIDTH - 26,
        y: area.y + 26,
        width: ORB_WIDTH,
        height: ORB_HEIGHT,
      },
      true,
    );
  }
}

/**
 * POINT AND ASK.
 *
 * Nus' second gesture: press a key on top of anything, and the answer arrives
 * pointing at that exact spot. The still is taken here, the cursor is turned
 * into a fraction of the display, and the overlay owns the turn so the answer
 * streams where the person is already looking.
 */
async function pointAndAsk(question?: string) {
  const settings = store.getSettings();
  const knot = overlayWin ?? createOverlay();
  showOverlay(false, false);
  const tell = (text: string) => {
    const send = () => knot.webContents.send("viv:overlay:notice", text);
    if (knot.webContents.isLoading()) knot.webContents.once("did-finish-load", send);
    else send();
  };
  if (!settings.abilities?.screen) {
    tell("Point and ask needs screen access. Turn it on in Settings → Machine access.");
    return;
  }
  try {
    const shot = await captureScreen(store.dir);
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getPrimaryDisplay();
    const fx = Math.min(1, Math.max(0, (cursor.x - display.bounds.x) / display.bounds.width));
    const fy = Math.min(1, Math.max(0, (cursor.y - display.bounds.y) / display.bounds.height));
    const prompt = [
      `Point and ask. My cursor is at ${Math.round(fx * 100)}% across and ${Math.round(fy * 100)}% down the primary display, and a still of it is saved at ${shot.path}.`,
      "Read that image first (ViewImage) and look at that spot, not the whole desktop.",
      "In two sentences, tell me what is there and what I can do with it. If you cannot read the image, say so plainly instead of guessing.",
      question ? `What I asked: ${question}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const send = () => knot.webContents.send("viv:overlay:point", { prompt });
    if (knot.webContents.isLoading()) knot.webContents.once("did-finish-load", send);
    else send();
  } catch (err) {
    tell(`Could not take the still: ${String(err instanceof Error ? err.message : err)}`);
  }
}

function registerOverlayShortcut() {
  try {
    const ok = globalShortcut.register(OVERLAY_SHORTCUT, () => showOverlay(true));
    if (!ok) console.info(`[overlay] ${OVERLAY_SHORTCUT} is already taken by another app`);
  } catch (err) {
    console.info(`[overlay] shortcut did not register: ${err instanceof Error ? err.message : err}`);
  }
  try {
    const ok = globalShortcut.register(POINT_SHORTCUT, () => void pointAndAsk());
    if (!ok) console.info(`[overlay] ${POINT_SHORTCUT} is already taken by another app or the focused window`);
  } catch (err) {
    console.info(`[overlay] point shortcut did not register: ${err instanceof Error ? err.message : err}`);
  }
}

function registerIpc() {
  const send = (channel: string, payload: unknown) => {
    win?.webContents.send(channel, payload);
  };

  ipcMain.handle("viv:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: store.dir,
  }));

  ipcMain.handle("viv:settings:get", () => store.getSettings());
  ipcMain.handle("viv:settings:set", (_e, patch: Partial<Settings>) => store.setSettings(patch));
  ipcMain.handle("viv:settings:setKey", (_e, key: string) => store.setApiKey(key));
  ipcMain.handle("viv:settings:pickRoot", async () => {
    const result = await dialog.showOpenDialog(win!, {
      title: "Allow a folder",
      properties: ["openDirectory", "multiSelections"],
    });
    if (result.canceled) return store.getSettings();
    const roots = Array.from(new Set([...store.getSettings().roots, ...result.filePaths]));
    return store.setSettings({ roots });
  });

  ipcMain.handle("viv:agents:list", () => store.listAgents());
  ipcMain.handle("viv:agents:save", (_e, agents: AgentRecord[]) => store.saveAgents(agents));
  ipcMain.handle("viv:agents:state", (_e, id: string, state: AgentState) => {
    store.setAgentState(id, state);
  });

  ipcMain.handle("viv:chat:history", (_e, agentId?: string) => store.history(agentId));
  ipcMain.handle("viv:chat:clear", () => {
    store.clearThread();
  });
  ipcMain.handle("viv:chat:send", (_e, agentId: string, text: string, spoken?: boolean) =>
    runtime.send(agentId, text, { spoken: Boolean(spoken) }),
  );
  ipcMain.handle("viv:chat:steer", (_e, runId: string, text: string) => runtime.steer(runId, text));
  ipcMain.handle("viv:chat:cancel", (_e, runId: string) => {
    runtime.cancel(runId);
  });

  ipcMain.handle("viv:overlay:show", () => {
    showOverlay();
    return true;
  });
  ipcMain.handle("viv:overlay:hide", () => {
    overlayWin?.hide();
  });
  ipcMain.handle("viv:overlay:toggle", () => toggleOverlay());
  ipcMain.handle("viv:overlay:talk", () => {
    showOverlay(true);
    return true;
  });
  ipcMain.handle("viv:overlay:resize", (_e, width: number, height: number) =>
    resizeOverlay(width, height),
  );
  ipcMain.handle("viv:overlay:island", (_e, on: boolean) => applyIsland(Boolean(on)));
  ipcMain.handle("viv:overlay:status", () => ({
    visible: Boolean(overlayWin?.isVisible()),
    shortcut: OVERLAY_SHORTCUT,
    registered: globalShortcut.isRegistered(OVERLAY_SHORTCUT),
  }));

  ipcMain.handle("viv:tools:decide", (_e, requestId: string, decision: "allow" | "always" | "deny") => {
    runtime.decide(requestId, decision);
  });

  ipcMain.handle("viv:memory:list", () => store.listMemory());
  ipcMain.handle("viv:memory:add", (_e, text: string) => store.addMemory(text, "manual"));
  ipcMain.handle("viv:memory:update", (_e, id: string, text: string) => store.updateMemory(id, text));
  ipcMain.handle("viv:memory:forget", (_e, id: string) => store.forgetMemory(id));

  // ---- skills, connections, screen, usage ---------------------------------
  //
  // Skills live in the main process because the runtime reads them on every
  // turn. The window is a view over the same file, not a second copy.
  ipcMain.handle("viv:skills:list", () => store.listSkills());
  ipcMain.handle("viv:skills:save", (_e, skill: Partial<SkillRecord> & { name: string }) => {
    store.saveSkill(skill);
    return store.listSkills();
  });
  ipcMain.handle("viv:skills:remove", (_e, id: string) => store.removeSkill(id));

  ipcMain.handle("viv:integrations:scan", () => scanIntegrations(store));

  ipcMain.handle("viv:screen:preview", async () => {
    const shot = await captureScreen(store.dir);
    return { dataUrl: shot.dataUrl, width: shot.width, height: shot.height, at: shot.at };
  });
  ipcMain.handle("viv:screen:status", () => ({
    enabled: Boolean(store.getSettings().abilities?.screen),
    platform: process.platform,
  }));

  // ---- live screen view ---------------------------------------------------
  // The person looking at their own screen is not the same as her deciding to
  // look: frames here are not written to disk, and a click from this view is the
  // person's own action. Hands still have to be switched on.
  ipcMain.handle("viv:screen:live", () => captureScreen(store.dir, false));
  ipcMain.handle("viv:screen:windows", async () => (handsReady() ? listWindows() : []));
  const actsOnScreen = () => {
    if (!handsReady()) throw new Error("Screen control is only wired for Windows right now.");
    if (!store.getSettings().abilities?.hands) {
      throw new Error("Control this computer is off. Turn it on in Settings → Machine access.");
    }
  };
  ipcMain.handle("viv:screen:click", async (_e, fx: number, fy: number, title?: string) => {
    actsOnScreen();
    const bounds = screen.getPrimaryDisplay().size;
    const x = Math.round(Math.min(0.999, Math.max(0, Number(fx))) * bounds.width);
    const y = Math.round(Math.min(0.999, Math.max(0, Number(fy))) * bounds.height);
    const result = await clickAt(x, y, { title });
    return { x: result.x, y: result.y, window: result.probe.window.title };
  });
  ipcMain.handle("viv:screen:type", async (_e, text: string, submit?: boolean, title?: string) => {
    actsOnScreen();
    await typeText(String(text ?? ""), Boolean(submit), title);
  });
  ipcMain.handle("viv:screen:key", async (_e, keys: string, title?: string) => {
    actsOnScreen();
    await pressKeys(String(keys ?? ""), title);
  });
  ipcMain.handle("viv:screen:ask", () => {
    void pointAndAsk();
    return true;
  });

  // ---- guide overlay ------------------------------------------------------
  ipcMain.handle("viv:guide:show", (_e, payload: GuidePayload) => showGuide(payload));
  ipcMain.handle("viv:guide:hide", () => hideGuide());
  ipcMain.handle("viv:guide:status", () => guideStatus());
  ipcMain.handle("viv:guide:step", (_e, delta: number) => stepGuide(delta));

  // ---- recall vault -------------------------------------------------------
  ipcMain.handle("viv:vault:list", () => vault.list());
  ipcMain.handle("viv:vault:add", (_e, input: { title?: string; body: string; tags?: string[] }) => {
    vault.add(input);
    return vault.list();
  });
  ipcMain.handle("viv:vault:import", () => vault.importFiles());
  ipcMain.handle("viv:vault:importFolder", () => vault.importFolder());
  ipcMain.handle("viv:vault:search", (_e, query: string) => vault.search(query, 8));
  ipcMain.handle("viv:vault:read", (_e, id: string) => vault.read(id));
  ipcMain.handle("viv:vault:forget", (_e, id: string) => vault.forget(id));
  ipcMain.handle("viv:vault:status", () => vault.status());

  // ---- context packs ------------------------------------------------------
  ipcMain.handle("viv:packs:list", () => store.listPacks());
  ipcMain.handle("viv:packs:save", (_e, pack: Parameters<Store["savePack"]>[0]) => store.savePack(pack));
  ipcMain.handle("viv:packs:remove", (_e, id: string) => store.removePack(id));
  ipcMain.handle("viv:packs:attach", (_e, id: string | null) => store.attachPack(id));
  ipcMain.handle("viv:packs:attached", () => store.getAttachedPack()?.id ?? null);

  // ---- routines: they run in the main process, not in this window ----------
  ipcMain.handle("viv:routines:list", () => store.listRoutines());
  ipcMain.handle(
    "viv:routines:save",
    (_e, routine: Parameters<Store["saveRoutine"]>[0]) => {
      store.saveRoutine(routine);
      return store.listRoutines();
    },
  );
  ipcMain.handle("viv:routines:remove", (_e, id: string) => store.removeRoutine(id));
  ipcMain.handle("viv:routines:run", (_e, id: string) => {
    fireRoutine(id, true);
    return store.listRoutines();
  });

  ipcMain.handle("viv:feedback:rate", (_e, runId: string, value: "up" | "down" | null) =>
    store.rateFeedback(runId, value),
  );

  ipcMain.handle("viv:usage:get", () => store.usageReport());

  // ---- voice (ElevenLabs) -------------------------------------------------
  //
  // The key never crosses the bridge back to the renderer: it is decrypted here,
  // used for one request, and dropped. Audio comes back as a data URL because
  // the renderer plays it with an <audio> element.
  const VOICE_API = "https://api.elevenlabs.io/v1";
  /** Their error body is a JSON paragraph; turn it into one sentence a person can act on. */
  const voiceError = (status: number, body: string) => {
    try {
      const detail = (JSON.parse(body) as { detail?: { code?: string; message?: string; status?: string } })
        .detail;
      if (detail?.code === "quota_exceeded" || detail?.status === "quota_exceeded") {
        return "ElevenLabs says this account has no credits left. Top up, then try again — the key itself is fine.";
      }
      if (detail?.code === "invalid_api_key" || status === 401) {
        return "ElevenLabs refused that key. Check it in Settings → Companion → Voice.";
      }
      if (detail?.message) return `ElevenLabs: ${detail.message}`;
    } catch {
      // not JSON — fall through to the status line
    }
    return `ElevenLabs request failed (${status}).`;
  };
  const voiceAuth = () => {
    const key = store.getVoiceKey();
    if (!key) throw new Error("No ElevenLabs key yet — add one in Settings → Companion → Voice.");
    return { "xi-api-key": key };
  };
  const voiceStatus = () => ({
    hasKey: store.hasVoiceKey(),
    voiceId: store.getSettings().voiceId ?? "",
    source: store.voiceKeySource(),
    stt: sttStatus(),
  });
  let voiceCache: { at: number; rows: { id: string; name: string; detail: string; preview: string }[] } | null = null;
  // A key that answers 401 will do so on every clip. Stop paying that round trip
  // for half an hour; the local recogniser is already the first choice.
  let hostedSttBlockedUntil = 0;

  ipcMain.handle("viv:voice:status", () => voiceStatus());

  // ---- the free OS voice --------------------------------------------------
  //
  // ElevenLabs needs credits; Windows already ships voices that cost nothing and
  // speak offline. They are the fallback, not a replacement: same words, no key.
  const powershell = (script: string) =>
    new Promise<string>((resolve, reject) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, timeout: 15_000 },
        (err, stdout) => (err ? reject(new Error(err.message)) : resolve(stdout)),
      );
    });

  ipcMain.handle("viv:voice:systemVoices", async () => {
    if (process.platform !== "win32") return [];
    try {
      const out = await powershell(
        "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }",
      );
      return out
        .split(/\r?\n/)
        .map((name) => name.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  });

  ipcMain.handle("viv:voice:systemSpeak", (_e, text: string, voice?: string) => {
    if (process.platform !== "win32") {
      throw new Error("The free system voice is wired for Windows only right now.");
    }
    const clean = String(text ?? "").slice(0, 4000);
    if (!clean.trim()) return;
    console.info(`[voice] free system voice: ${clean.length} characters`);
    const b64 = Buffer.from(clean, "utf8").toString("base64");
    const safeVoice = String(voice ?? "").replace(/'/g, "''");
    const script = [
      "Add-Type -AssemblyName System.Speech",
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
      safeVoice ? `try { $s.SelectVoice('${safeVoice}') } catch {}` : "",
      `$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))`,
      "$s.Speak($t)",
    ]
      .filter(Boolean)
      .join("; ");
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    child.unref();
  });

  ipcMain.handle("viv:voice:setKey", (_e, key: string) => {
    store.setVoiceKey(key);
    voiceCache = null;
    return voiceStatus();
  });

  ipcMain.handle("viv:voice:installStt", () => installStt());
  ipcMain.handle("viv:voice:neural", (_e, text: string, style?: string) => neuralSpeech(text, style));
  ipcMain.handle("viv:voice:action", (_e, text: string) => runVoiceAction(String(text ?? ""), store));

  ipcMain.handle("viv:voice:list", async () => {
    if (!store.hasVoiceKey()) return [];
    if (voiceCache && Date.now() - voiceCache.at < 5 * 60_000) return voiceCache.rows;
    const res = await fetch(`${VOICE_API}/voices`, {
      headers: voiceAuth(),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(voiceError(res.status, await res.text().catch(() => "")));
    const json = (await res.json()) as {
      voices?: {
        voice_id: string;
        name: string;
        preview_url?: string;
        labels?: Record<string, string>;
      }[];
    };
    const rows = (json.voices ?? []).map((v) => {
      const labels = v.labels ?? {};
      const detail = [labels.accent, labels.description ?? labels.use_case, labels.gender]
        .filter(Boolean)
        .slice(0, 2)
        .join(" · ");
      return { id: v.voice_id, name: v.name, detail, preview: v.preview_url ?? "" };
    });
    voiceCache = { at: Date.now(), rows };
    return rows;
  });

  ipcMain.handle("viv:voice:speak", async (_e, text: string) => {
    const clean = String(text ?? "").trim().slice(0, 3000);
    if (!clean) throw new Error("Nothing to say.");
    let voiceId = store.getSettings().voiceId ?? "";
    if (!voiceId) {
      const res = await fetch(`${VOICE_API}/voices`, {
        headers: voiceAuth(),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(voiceError(res.status, await res.text().catch(() => "")));
      const json = (await res.json()) as { voices?: { voice_id: string }[] };
      voiceId = json.voices?.[0]?.voice_id ?? "";
      if (!voiceId) throw new Error("This ElevenLabs account has no voices.");
    }
    const res = await fetch(`${VOICE_API}/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { ...voiceAuth(), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text: clean,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(voiceError(res.status, await res.text().catch(() => "")));
    const audio = Buffer.from(await res.arrayBuffer());
    return { audio: `data:audio/mpeg;base64,${audio.toString("base64")}` };
  });

  // ---- hearing her, for free ---------------------------------------------
  //
  // Scribe is the good transcriber, but it is the first thing a key without
  // credits loses. Windows ships a dictation engine that runs offline; the
  // renderer records WAV precisely so this path can read it. Hosted first,
  // then here — the same shape as the free voice.
  const systemTranscribe = async (wav: Buffer): Promise<string> => {
    if (process.platform !== "win32") {
      throw new Error("Offline transcription is wired for Windows only right now.");
    }
    const file = path.join(app.getPath("temp"), `viv-voice-${Date.now()}.wav`);
    fs.writeFileSync(file, wav);
    const safe = file.replace(/'/g, "''");
    const script = [
      "Add-Type -AssemblyName System.Speech",
      "$info = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'en-US' } | Select-Object -First 1",
      "if (-not $info) { exit 3 }",
      "$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)",
      "$r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))",
      `$r.SetInputToWaveFile('${safe}')`,
      "$text = ''",
      "while ($true) { $res = $r.Recognize([TimeSpan]::FromSeconds(8)); if ($null -eq $res) { break }; $text += $res.Text + ' ' }",
      "$r.Dispose()",
      "$text.Trim()",
    ].join("; ");
    try {
      const out = await new Promise<string>((resolve, reject) => {
        execFile(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
          { windowsHide: true, timeout: 45_000 },
          (err, stdout) => (err ? reject(new Error(err.message)) : resolve(stdout)),
        );
      });
      return out.trim();
    } finally {
      try {
        fs.unlinkSync(file);
      } catch {
        // the recogniser may still be releasing it; a stray temp file is harmless
      }
    }
  };

  ipcMain.handle("viv:voice:transcribe", async (_e, bytes: Uint8Array, mime: string) => {
    if (!bytes || bytes.length < 800) throw new Error("That clip was too short to transcribe.");
    const wav = Buffer.from(bytes);
    // The local model is tried first even when a hosted key exists: it is free,
    // private, and works on a plane. Windows' recogniser is the second offline
    // try; Scribe is only reached when neither local engine heard anything.
    const local = await transcribeLocal(wav, store.dir);
    // If the local model ran, it is the answer — including an empty one. Sending
    // silence to a second recogniser is how a conversation gets invented words.
    if (local.ran) return local.text;
    const offline = () => systemTranscribe(wav);
    if (!store.hasVoiceKey() || Date.now() < hostedSttBlockedUntil) return offline();

    const form = new FormData();
    form.append("file", new Blob([wav], { type: mime || "audio/wav" }), "speech.wav");
    form.append("model_id", "scribe_v1");
    try {
      const res = await fetch(`${VOICE_API}/speech-to-text`, {
        method: "POST",
        headers: voiceAuth(),
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) hostedSttBlockedUntil = Date.now() + 30 * 60_000;
        console.info(`[voice] hosted transcription failed (${res.status}); using the offline engine`);
        return offline();
      }
      const json = (await res.json()) as { text?: string };
      const text = (json.text ?? "").trim();
      return text || offline();
    } catch (err) {
      console.info(`[voice] hosted transcription unreachable; using the offline engine (${String(err).slice(0, 120)})`);
      return offline();
    }
  });

  ipcMain.handle("viv:files:list", () => listFiles(store.getSettings().roots));
  ipcMain.handle("viv:files:read", (_e, target: string): FilePreview => {
    const roots = store.getSettings().roots.map((r) => path.resolve(r));
    const file = resolveInRoots(target, roots);
    if (!file) throw new Error("That file is outside the folders you allowed.");
    const stat = fs.statSync(file);
    const bytes = stat.size;
    // Read a window, not the file: a log or an archive must not be pulled into
    // memory just to be looked at.
    const take = Math.min(bytes, 400_000);
    const slice = Buffer.alloc(take);
    const fd = fs.openSync(file, "r");
    try {
      fs.readSync(fd, slice, 0, take, 0);
    } finally {
      fs.closeSync(fd);
    }
    const binary = slice.includes(0);
    return {
      path: file,
      name: path.basename(file),
      text: binary ? "" : slice.toString("utf8"),
      bytes,
      truncated: bytes > slice.length,
      binary,
    };
  });
  ipcMain.handle(
    "viv:files:image",
    (_e, target: string): { path: string; name: string; dataUrl: string; bytes: number } => {
      const roots = store.getSettings().roots.map((r) => path.resolve(r));
      const raw = path.resolve(target);
      let real: string;
      try {
        real = fs.realpathSync.native(raw);
      } catch {
        throw new Error("That image does not exist yet.");
      }
      // Images live in a granted folder or in this app's own data folder
      // (generated images, screenshots). Anything else is not readable here.
      if (!under(store.dir, real) && !roots.some((root) => under(root, real))) {
        throw new Error("That image is outside the folders you allowed.");
      }
      const mime = ({
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
      } as Record<string, string>)[path.extname(real).toLowerCase()] ?? "";
      if (!mime) throw new Error("That file is not an image this chat can show.");
      const stat = fs.statSync(real);
      if (stat.size > 24 * 1024 * 1024) throw new Error("That image is larger than 24 MB.");
      const data = fs.readFileSync(real).toString("base64");
      return {
        path: real,
        name: path.basename(real),
        dataUrl: `data:${mime};base64,${data}`,
        bytes: stat.size,
      };
    },
  );

  ipcMain.handle("viv:files:open", async (_e, target: string) => {
    const roots = store.getSettings().roots.map((r) => path.resolve(r));
    const file = resolveInRoots(target, roots);
    if (file) await shell.openPath(file);
  });

  ipcMain.handle("viv:audit:list", () => store.listAudit());
  ipcMain.handle("viv:data:export", () => store.exportAll());
  ipcMain.handle("viv:data:open", async () => {
    await shell.openPath(store.dir);
  });
  ipcMain.handle("viv:data:reset", () => {
    store.resetLocalState();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  // Her voice is played from a data URL after an async turn, which Chromium's
  // default autoplay policy can refuse even though the person started the turn.
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

  app.whenReady().then(async () => {
    // Windows groups notifications under the app id; without one they can be
    // silently dropped by the Action Center.
    if (process.platform === "win32") app.setAppUserModelId("com.vivarium.os");
    store = new Store();
    vault = new Vault(store.dir);
    installHands(store.dir);
    configureStt(store.dir);
    sweepStt(store.dir);
    // Wake DNS, TLS and the neural voice engine while the window is still
    // painting, so the first reply has a voice ready instead of a cold timeout.
    setTimeout(() => void warmNeuralVoice(), 1200);
    // Keep our own copy of the recogniser if speech is still borrowed from the
    // companion app it came from: uninstalling that app must not deafen this one.
    setTimeout(() => {
      try {
        const found = sttStatus();
        if (found.bin && !found.bin.startsWith(store.dir)) {
          const copied = installStt();
          console.info(`[stt] kept a local copy of the recogniser (${copied.backend})`);
        }
      } catch {
        // A failed copy only costs the convenience; the borrowed one still works.
      }
    }, 6000);
    // CLI minds get the app's own screen, vault and memory tools through a local
    // MCP bridge, plus the signed-in browser through neo's server.
    appBridge = await startAppBridge(store, vault, async (tool, args) => {
      // Hands from a CLI go through the same approval cards as the app's own
      // tools. The runtime is assigned a few lines below; this callback runs
      // only once a turn asks for it, long after startup.
      if (!runtime) return false;
      const decision = await runtime.askExternal({
        tool,
        args,
        danger: "exec",
        summary: JSON.stringify(args).slice(0, 400),
      });
      return decision !== "deny";
    }).catch((err) => {
      console.info(`[mcp] app tools did not start: ${err instanceof Error ? err.message : err}`);
      return null;
    });
    installCliBridge(store.dir, appBridge ?? undefined);
    // Every event the runtime produces goes out on one channel; the preload
    // wraps it in `chat.onEvent`, so the renderer never sees IPC names.
    runtime = new Runtime(store, (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send("viv:chat:event", event);
      }
      // A routine's answer is announced when it finishes, wherever the window is.
      observeRoutineRun(event);
      // Settings → Channels → On this computer. Only when the window is not in
      // front: a notification for a reply already on screen is noise.
      if (event.type === "done" && store.getSettings().notifyOs && win && !win.isFocused()) {
        if (Notification.isSupported()) {
          const record = store.listRuns().find((r) => r.id === event.runId);
          new Notification({
            title: `${record?.agentName ?? "She"} finished`,
            body: record ? `${record.hops + 1} turn(s), ${record.toolCalls} tool call(s).` : "An answer is ready.",
            silent: false,
          }).show();
        }
      }
    }, vault);
    // CLI agents run their own tools. The bridge gives them somewhere to ask,
    // and every card lands in the same stack as her own tool calls.
    hooks = new HookBridge({
      ask: (request) => runtime.askExternal(request),
      dispatch: (worker) => runtime.noteCliDispatch(worker),
      report: (worker) => runtime.noteCliReport(worker),
    });
    // Before the window exists: a CLI launched from the first message must
    // already have somewhere to ask.
    await hooks.start(store.dir).catch((err) => {
      console.info(`[hooks] approval bridge did not start: ${err instanceof Error ? err.message : err}`);
    });
    registerIpc();
    createWindow();
    createOverlay();
    registerOverlayShortcut();
    startScheduler({
      store,
      send: (prompt, agentId) => {
        const id = agentId ?? store.listAgents().find((a) => a.isOrchestrator)?.id ?? store.listAgents()[0]?.id;
        if (!id) throw new Error("There is no companion to run this routine.");
        return runtime.send(id, prompt);
      },
      notify: (title, body) => {
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send("viv:routine:fire", { title, body });
        if (!store.getSettings().notifyOs) return;
        if (!Notification.isSupported()) return;
        new Notification({ title, body, silent: false }).show();
      },
      broadcast: () => undefined,
    });

    app.on("activate", () => {
      if (!win) createWindow();
      if (!overlayWin) createOverlay();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    quitting = true;
  });    app.on("will-quit", () => {
      destroyGuide();
      globalShortcut.unregisterAll();
      hooks?.stop();
    });
}
