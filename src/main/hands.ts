import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { showPointer } from "./guide";

/**
 * HANDS ON WINDOWS.
 *
 * A small, auditable UI-automation layer: read a window's control tree through
 * UI Automation, then click or type only after the ordinary approval card has
 * been answered. The pointer is drawn before every click, so the person sees
 * where the hand is going.
 *
 * All of it runs through one PowerShell helper kept in the data folder. Nothing
 * is injected into the command line except numbers and a base64 text payload,
 * and the helper refuses coordinates outside the probed screen.
 */

const SCRIPT = "param(\n  [string]$Action = \"probe\",\n  [string]$Title = \"\",\n  [long]$Handle = 0,\n  [double]$X = 0,\n  [double]$Y = 0,\n  [string]$TextB64 = \"\",\n  [string]$Keys = \"\",\n  [int]$Amount = 3\n)\n\n$ErrorActionPreference = \"Stop\"\nAdd-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms\n\nif (-not (\"HandsNative\" -as [type])) {\n  Add-Type @\"\nusing System;\nusing System.Runtime.InteropServices;\npublic class HandsNative {\n  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();\n  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);\n  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);\n  [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x, int y);\n  [DllImport(\"user32.dll\")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);\n  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int max);\n}\n\"@\n}\n\nfunction Resolve-Window {\n  if ($Handle -ne 0) { return [IntPtr]$Handle }\n  if ($Title) {\n    $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like \"*$Title*\" } | Select-Object -First 1\n    if ($p) { return [IntPtr]$p.MainWindowHandle }\n    throw \"No window matching '$Title'.\"\n  }\n  return [HandsNative]::GetForegroundWindow()\n}\n\nfunction Get-WindowTitle([IntPtr]$h) {\n  $sb = New-Object System.Text.StringBuilder 512\n  [void][HandsNative]::GetWindowText($h, $sb, 512)\n  return $sb.ToString()\n}\n\nfunction Get-WindowProcess([IntPtr]$h) {\n  $procId = 0\n  [void][HandsNative]::GetWindowThreadProcessId($h, [ref]$procId)\n  try { return (Get-Process -Id $procId).ProcessName } catch { return \"\" }\n}\n\nfunction Invoke-Probe {\n  $hwnd = Resolve-Window\n  $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)\n  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker\n  $elements = New-Object System.Collections.ArrayList\n  $script:seen = 0\n\n  function Walk($el, $depth) {\n    if ($depth -gt 9 -or $elements.Count -ge 150 -or $script:seen -gt 900) { return }\n    $script:seen++\n    try {\n      $cur = $el.Current\n      $r = $cur.BoundingRectangle\n      $hasBox = ($r.Width -gt 0 -and $r.Height -gt 0)\n      if (-not $cur.IsOffscreen -and $hasBox -and ($cur.Name -or $cur.AutomationId)) {\n        $type = ($cur.ControlType.ProgrammaticName -replace \"ControlType\\.\", \"\")\n        $value = \"\"\n        try {\n          $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)\n          if ($vp) { $value = $vp.Current.Value }\n        } catch { }\n        if ($value.Length -gt 400) { $value = $value.Substring(0, 400) }\n        [void]$elements.Add([ordered]@{\n          id = $elements.Count\n          type = $type\n          name = $cur.Name\n          automationId = $cur.AutomationId\n          value = $value\n          enabled = $cur.IsEnabled\n          x = [math]::Round($r.X)\n          y = [math]::Round($r.Y)\n          w = [math]::Round($r.Width)\n          h = [math]::Round($r.Height)\n        })\n      }\n    } catch { }\n    $child = $null\n    try { $child = $walker.GetFirstChild($el) } catch { }\n    while ($null -ne $child) {\n      Walk $child ($depth + 1)\n      try { $child = $walker.GetNextSibling($child) } catch { $child = $null }\n    }\n  }\n\n  Walk $root 0\n  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds\n  $windows = @()\n  try {\n    $windows = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |\n      Select-Object -First 20 |\n      ForEach-Object { [ordered]@{ title = $_.MainWindowTitle; process = $_.ProcessName; handle = $_.MainWindowHandle.ToInt64() } }\n  } catch { }\n  $payload = [ordered]@{\n    window = [ordered]@{\n      title = (Get-WindowTitle $hwnd)\n      process = (Get-WindowProcess $hwnd)\n      handle = $hwnd.ToInt64()\n    }\n    screen = [ordered]@{ width = $screen.Width; height = $screen.Height }\n    elements = $elements\n    windows = $windows\n  }\n  return ($payload | ConvertTo-Json -Depth 8 -Compress)\n}\n\nfunction Invoke-Prepare([IntPtr]$hwnd) {\n  if ($hwnd -ne [IntPtr]::Zero) {\n    [void][HandsNative]::SetForegroundWindow($hwnd)\n    Start-Sleep -Milliseconds 140\n  }\n}\n\n$hwnd = [IntPtr]::Zero\ntry { $hwnd = Resolve-Window } catch { if ($Action -eq \"probe\") { throw } }\n\nswitch ($Action) {\n  \"probe\" { Invoke-Probe }\n  \"click\" {\n    Invoke-Prepare $hwnd\n    [void][HandsNative]::SetCursorPos([int]$X, [int]$Y)\n    Start-Sleep -Milliseconds 90\n    [HandsNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)\n    [HandsNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)\n    return (@{ ok = $true; x = $X; y = $Y } | ConvertTo-Json -Compress)\n  }\n  \"move\" {\n    [void][HandsNative]::SetCursorPos([int]$X, [int]$Y)\n    return (@{ ok = $true; x = $X; y = $Y } | ConvertTo-Json -Compress)\n  }\n  \"type\" {\n    Invoke-Prepare $hwnd\n    $text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($TextB64))\n    $old = $null\n    try { $old = Get-Clipboard -Raw -ErrorAction SilentlyContinue } catch { }\n    Set-Clipboard -Value $text\n    Start-Sleep -Milliseconds 80\n    [System.Windows.Forms.SendKeys]::SendWait(\"^v\")\n    Start-Sleep -Milliseconds 180\n    if ($null -ne $old) {\n      try { Set-Clipboard -Value $old } catch { }\n    }\n    return (@{ ok = $true; chars = $text.Length } | ConvertTo-Json -Compress)\n  }\n  \"key\" {\n    Invoke-Prepare $hwnd\n    [System.Windows.Forms.SendKeys]::SendWait($Keys)\n    return (@{ ok = $true; keys = $Keys } | ConvertTo-Json -Compress)\n  }\n  \"scroll\" {\n    Invoke-Prepare $hwnd\n    if ($X -ne 0 -or $Y -ne 0) { [void][HandsNative]::SetCursorPos([int]$X, [int]$Y); Start-Sleep -Milliseconds 60 }\n    [HandsNative]::mouse_event(0x0800, 0, 0, [uint32]($Amount * 120), [UIntPtr]::Zero)\n    return (@{ ok = $true; amount = $Amount } | ConvertTo-Json -Compress)\n  }\n  default { throw \"Unknown action: $Action\" }\n}\n";

export interface HandsElement {
  id: number;
  type: string;
  name: string;
  automationId: string;
  value: string;
  enabled: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HandsProbe {
  window: { title: string; process: string; handle: number };
  screen: { width: number; height: number };
  elements: HandsElement[];
  windows: { title: string; process: string; handle: number }[];
}

const run = promisify(execFile);
let scriptPath = "";
let last: HandsProbe | null = null;
let busy = false;

export function installHands(dir: string): void {
  if (process.platform !== "win32") return;
  try {
    const folder = path.join(dir, "hands");
    fs.mkdirSync(folder, { recursive: true });
    scriptPath = path.join(folder, "hands.ps1");
    fs.writeFileSync(scriptPath, SCRIPT, "utf8");
  } catch {
    scriptPath = "";
  }
}

export function handsReady(): boolean {
  return Boolean(scriptPath);
}

export function lastProbe(): HandsProbe | null {
  return last;
}

/** The windows a person can hand a click to, newest probe first. */
export async function listWindows(): Promise<HandsProbe["windows"]> {
  const probe = await probeWindow();
  const rows = probe.windows ?? [];
  // Put the window that is actually in front at the top. The probe enumerates
  // processes, not z-order; without this, a click could land on the Xbox app
  // because it happened to start before the browser.
  const front = rows.findIndex((row) => row.title === probe.window.title);
  if (front > 0) rows.unshift(rows.splice(front, 1)[0]);
  return rows;
}

async function ps(action: string, args: string[]): Promise<Record<string, unknown>> {
  if (!scriptPath) throw new Error("Hands are only available on Windows in this build.");
  if (busy) throw new Error("Another hand action is still running.");
  busy = true;
  try {
    const { stdout, stderr } = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Action", action, ...args],
      { timeout: 25_000, windowsHide: true, maxBuffer: 4_000_000 },
    );
    const text = stdout.trim();
    if (!text) throw new Error(stderr.trim() || "The UI helper returned nothing.");
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(text.slice(0, 500));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      message
        .replace(/^Command failed:.*\n/, "")
        .replace(/\r?\nAt .*$/s, "")
        .trim() || "The UI helper failed.",
    );
  } finally {
    busy = false;
  }
}

export async function probeWindow(title?: string): Promise<HandsProbe> {
  const args: string[] = [];
  if (title && title.trim()) args.push("-Title", title.trim());
  const raw = (await ps("probe", args)) as unknown as HandsProbe;
  last = raw;
  return raw;
}

async function ensureProbe(title?: string): Promise<HandsProbe> {
  if (title?.trim() || !last) return probeWindow(title);
  return last;
}

export async function clickAt(
  x: number,
  y: number,
  options: { title?: string; label?: string } = {},
): Promise<{ probe: HandsProbe; x: number; y: number }> {
  const probe = await ensureProbe(options.title);
  const px = Math.round(Math.min(Math.max(0, x), probe.screen.width - 1));
  const py = Math.round(Math.min(Math.max(0, y), probe.screen.height - 1));
  showPointer(px / probe.screen.width, py / probe.screen.height, options.label || "Clicking");
  await new Promise((resolve) => setTimeout(resolve, 420));
  await ps("click", ["-Handle", String(probe.window.handle), "-X", String(px), "-Y", String(py)]);
  return { probe, x: px, y: py };
}

export async function moveTo(x: number, y: number, label?: string): Promise<void> {
  const probe = await ensureProbe();
  const px = Math.round(Math.min(Math.max(0, x), probe.screen.width - 1));
  const py = Math.round(Math.min(Math.max(0, y), probe.screen.height - 1));
  showPointer(px / probe.screen.width, py / probe.screen.height, label || "Moving");
  await ps("move", ["-Handle", String(probe.window.handle), "-X", String(px), "-Y", String(py)]);
}

export async function typeText(text: string, submit = false, title?: string): Promise<HandsProbe> {
  if (!text) throw new Error("There is no text to type.");
  const probe = await ensureProbe(title);
  await ps("type", [
    "-Handle",
    String(probe.window.handle),
    "-TextB64",
    Buffer.from(text, "utf8").toString("base64"),
  ]);
  if (submit) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await ps("key", ["-Handle", String(probe.window.handle), "-Keys", "{ENTER}"]);
  }
  return probe;
}

export function toSendKeys(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("No key was given.");
  if (/^[\^%+{]/.test(trimmed)) return trimmed;
  const parts = trimmed.toUpperCase().split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.pop() ?? "";
  let prefix = "";
  for (const part of parts) {
    if (part === "CTRL" || part === "CONTROL") prefix += "^";
    else if (part === "SHIFT") prefix += "+";
    else if (part === "ALT") prefix += "%";
  }
  const named: Record<string, string> = {
    ENTER: "{ENTER}",
    RETURN: "{ENTER}",
    TAB: "{TAB}",
    ESC: "{ESC}",
    ESCAPE: "{ESC}",
    BACKSPACE: "{BACKSPACE}",
    DELETE: "{DELETE}",
    UP: "{UP}",
    DOWN: "{DOWN}",
    LEFT: "{LEFT}",
    RIGHT: "{RIGHT}",
    HOME: "{HOME}",
    END: "{END}",
    PAGEUP: "{PGUP}",
    PAGEDOWN: "{PGDN}",
    SPACE: " ",
  };
  if (/^F([1-9]|1[0-2])$/.test(key)) return prefix + "{" + key + "}";
  return prefix + (named[key] ?? key.toLowerCase());
}

export async function pressKeys(keys: string, title?: string): Promise<HandsProbe> {
  const probe = await ensureProbe(title);
  await ps("key", ["-Handle", String(probe.window.handle), "-Keys", toSendKeys(keys)]);
  return probe;
}

export async function scroll(amount: number, x?: number, y?: number): Promise<HandsProbe> {
  const probe = await ensureProbe();
  const args = ["-Handle", String(probe.window.handle), "-Amount", String(Math.max(-20, Math.min(20, Math.round(amount))))];
  if (typeof x === "number" && typeof y === "number") args.push("-X", String(Math.round(x)), "-Y", String(Math.round(y)));
  await ps("scroll", args);
  return probe;
}

/** One readable block for the model: window, screen and the named controls. */
export function describeProbe(probe: HandsProbe): string {
  const lines = [
    `Window: “${probe.window.title}” (${probe.window.process}), handle ${probe.window.handle}`,
    `Screen: ${probe.screen.width}×${probe.screen.height} pixels. Coordinates below are pixels from the top-left.`,
    "",
    "Controls:",
  ];
  for (const element of probe.elements.slice(0, 120)) {
    const bits = [
      `#${element.id}`,
      element.type,
      element.name ? JSON.stringify(element.name.slice(0, 80)) : "(unnamed)",
      element.value ? `value=${JSON.stringify(element.value.slice(0, 80))}` : "",
      `(${element.x},${element.y} ${element.w}×${element.h})`,
      element.enabled ? "" : "disabled",
    ].filter(Boolean);
    lines.push(bits.join("  "));
  }
  if (probe.windows.length > 1) {
    lines.push("", "Open windows: " + probe.windows.slice(0, 12).map((w) => `${w.title} [${w.process}]`).join(" · "));
  }
  return lines.join("\n");
}
