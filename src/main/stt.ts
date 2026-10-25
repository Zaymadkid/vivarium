import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

/**
 * OFFLINE SPEECH.
 *
 * The talk key should not stop working when a hosted key runs out or the network
 * is down. Whisper.cpp is a single binary and one model file, and many machines
 * already have a copy; this finds one, runs it on the clip and returns plain
 * text. The app's own data folder is checked first, then a normal installation,
 * then any recogniser already on the machine (whisper.cpp is MIT and the model
 * is a local file the person already has — nothing is downloaded here).
 *
 * When no whisper.cpp is present the caller falls back to Windows' own
 * recogniser, and then to the hosted service if one is configured.
 */

const run = promisify(execFile);

export interface SttStatus {
  available: boolean;
  backend: string;
  model?: string;
  bin?: string;
  detail?: string;
}

interface Found {
  bin: string;
  model: string;
  backend: string;
}

let cached: Found | null | undefined;
let appDir = "";

/** Where a copy can be installed so hearing survives the other app's removal. */
export function configureStt(dir: string) {
  appDir = dir;
  cached = undefined;
}

const installedRoot = () => (appDir ? path.join(appDir, "stt", "whisper") : "");
const installedModels = () => (appDir ? path.join(appDir, "stt", "whisper-models") : "");

function modelsIn(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(".bin"))
      .sort((a, b) => {
        const rank = (name: string) => {
          const lower = name.toLowerCase();
          if (lower.includes("base.en")) return 0;
          if (lower.includes("small.en")) return 1;
          if (lower.includes("base")) return 2;
          if (lower.includes("tiny.en")) return 3;
          if (lower.includes("tiny")) return 4;
          return 5;
        };
        return rank(a) - rank(b) || a.localeCompare(b);
      })
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function firstExisting(paths: string[]): string {
  for (const candidate of paths) {
    try {
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* an unreadable path is not a candidate */
    }
  }
  return "";
}

function find(): Found | null {
  if (cached !== undefined) return cached;
  const envBin = process.env.VIV_WHISPER_BIN ?? "";
  const envModel = process.env.VIV_WHISPER_MODEL ?? "";
  const local = process.env.LOCALAPPDATA ?? "";
  const roots = [
    installedRoot(),
    path.join(os.homedir(), ".local", "bin"),
    "/usr/local/bin",
    "/usr/bin",
    path.join(local, "Programs", "nus-companion", "resources", "whisper"),
    path.join(local, "Programs", "whisper.cpp"),
    path.join(local, "whisper.cpp"),
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "whisper.cpp") : "",
  ].filter(Boolean);

  const bins = [envBin, "whisper-cli", "whisper", "main"].filter(Boolean);
  let bin = firstExisting([envBin]);
  if (!bin && envBin) {
    // An env var may name the folder, not the binary.
    bin = firstExisting([path.join(envBin, "whisper-cli.exe"), path.join(envBin, "whisper-cli")]);
  }
  for (const root of roots) {
    if (bin) break;
    bin = firstExisting([
      path.join(root, "whisper-cli.exe"),
      path.join(root, "whisper-cli"),
      path.join(root, "main.exe"),
      path.join(root, "main"),
      path.join(root, "whisper"),
    ]);
  }

  const modelCandidates = [envModel];
  const ours = installedModels();
  if (ours) modelCandidates.push(...modelsIn(ours), ...modelsIn(path.join(ours, "..", "whisper")), ...modelsIn(path.join(ours, "..", "..")));
  for (const root of roots) {
    modelCandidates.push(
      ...modelsIn(root),
      ...modelsIn(path.join(root, "models")),
      ...modelsIn(path.join(root, "..", "whisper-models")),
      ...modelsIn(path.join(root, "..", "models")),
    );
  }
  modelCandidates.push(...modelsIn(path.join(os.homedir(), "whisper.cpp", "models")));
  const model = firstExisting(modelCandidates);

  if (!bin && !model) {
    cached = null;
    return null;
  }
  if (!bin || !model) {
    // A half-install is still worth reporting so Settings can say what is missing.
    cached = null;
    return null;
  }
  cached = {
    bin,
    model,
    backend: path.basename(bin).startsWith("main") ? "whisper.cpp (legacy)" : "whisper.cpp",
  };
  return cached;
}

export function sttStatus(): SttStatus {
  const found = find();
  if (!found) {
    return {
      available: false,
      backend: "Windows Speech",
      detail: "No whisper.cpp model was found; the system recogniser is the offline fallback.",
    };
  }
  return {
    available: true,
    backend: found.backend,
    bin: found.bin,
    model: path.basename(found.model),
  };
}

function cleanOutput(raw: string): string {
  const lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(whisper_|ggml_|load_backend|read_audio_data|system_info|main:|error:|warning:)/i.test(line))
    .filter((line) => !/^\[\d{2}:\d{2}:\d{2}/.test(line))
    .filter((line) => !/^\[.*\]$/.test(line));
  return lines
    .join(" ")
    .replace(/\[(?:BLANK_AUDIO|MUSIC|APPLAUSE|LAUGHTER|NOISE|SILENCE)\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function runWhisper(found: Found, file: string): Promise<string> {
  const base = ["-m", found.model, "-f", file, "-l", "en", "-nt", "-t", "4"];
  try {
    const { stdout } = await run(found.bin, [...base, "-np"], {
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 8_000_000,
    });
    return cleanOutput(stdout);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Older whisper.cpp builds do not know -np; retry once without it rather
    // than making a working binary look broken.
    if (!/unknown|invalid|unrecognized/i.test(message)) throw err;
    const { stdout } = await run(found.bin, base, {
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 8_000_000,
    });
    return cleanOutput(stdout);
  }
}

/**
 * The text of a clip, and whether the local engine actually ran.
 *
 * `ran: true, text: ""` means whisper listened and heard no words — the caller
 * must not send that silence to another engine, which would invent a sentence.
 * `ran: false` is a missing or broken engine, where a fallback is the right move.
 */
export interface LocalTranscript {
  ran: boolean;
  text: string;
}

export async function transcribeLocal(bytes: Buffer, dataDir: string): Promise<LocalTranscript> {
  const found = find();
  if (!found) return { ran: false, text: "" };
  const folder = path.join(dataDir, "stt");
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `clip-${Date.now()}-${process.pid}.wav`);
  try {
    fs.writeFileSync(file, bytes);
    const text = await runWhisper(found, file);
    return { ran: true, text };
  } catch (err) {
    console.info(`[stt] whisper.cpp failed: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
    return { ran: false, text: "" };
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* Windows may hold it for a moment; the stt folder is swept on launch */
    }
  }
}

function copyTree(from: string, to: string) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

/**
 * Keep a copy of a whisper.cpp installation this machine already has, so the
 * feature does not break when the app it came from is uninstalled. Nothing is
 * downloaded; a missing source is reported, not fetched.
 */
export function installStt(): SttStatus {
  if (!appDir) return { available: false, backend: "none", detail: "The app data folder is not ready yet." };
  const local = process.env.LOCALAPPDATA ?? "";
  const sources = [
    path.join(local, "Programs", "nus-companion", "resources", "whisper"),
    path.join(local, "Programs", "whisper.cpp"),
    path.join(os.homedir(), "whisper.cpp", "build", "bin", "Release"),
    path.join(os.homedir(), "whisper.cpp"),
  ];
  const source = sources.find((dir) => fs.existsSync(path.join(dir, "whisper-cli.exe")) || fs.existsSync(path.join(dir, "main.exe")));
  if (!source) {
    return {
      available: false,
      backend: "Windows Speech",
      detail: "No whisper.cpp installation was found on this PC to copy. Put a build in %APPDATA%\\vivarium\\stt\\whisper to use it.",
    };
  }

  const binDir = installedRoot();
  const modelDir = installedModels();
  copyTree(source, binDir);

  const modelRoots = [
    path.join(local, "Programs", "nus-companion", "resources", "whisper-models"),
    path.join(source, "models"),
    path.join(source, "..", "whisper-models"),
    path.join(os.homedir(), "whisper.cpp", "models"),
  ];
  const model = modelRoots.map((dir) => modelsIn(dir)[0]).find(Boolean) ?? "";
  if (!model) {
    return {
      available: false,
      backend: "Windows Speech",
      detail: "The whisper.cpp program was copied, but no .bin model was found beside it.",
    };
  }
  fs.mkdirSync(modelDir, { recursive: true });
  fs.copyFileSync(model, path.join(modelDir, path.basename(model)));
  cached = undefined;
  return sttStatus();
}

/** Remove clips a crashed run left behind. */
export function sweepStt(dataDir: string) {
  const folder = path.join(dataDir, "stt");
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(folder)) {
      if (!name.startsWith("clip-")) continue;
      const target = path.join(folder, name);
      if (now - fs.statSync(target).mtimeMs > 3_600_000) fs.unlinkSync(target);
    }
  } catch {
    /* no folder yet */
  }
}
