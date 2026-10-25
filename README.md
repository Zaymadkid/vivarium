<p align="center">
  <img src="assets/banner.svg" alt="Vivarium — an open world for agents" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licence" src="https://img.shields.io/badge/licence-Apache--2.0-35E29B?style=flat-square"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-0B0F12?style=flat-square">
  <img alt="Built with" src="https://img.shields.io/badge/built%20with-Electron%20%C2%B7%20React%20%C2%B7%20three.js-5EEAD4?style=flat-square">
  <img alt="Local first" src="https://img.shields.io/badge/local--first-no%20telemetry-8AFFC9?style=flat-square">
</p>

<h3 align="center">Your agents don't live in a chat log. They live in a world.</h3>

**Vivarium** is a local-first desktop world for AI agents. Open it and you see them: a
companion breathing at the center of a dark sea, workers growing along threads when work
is handed over, a lit core that answers when you speak. Walk up, talk, hand over a job.
The world is the interface — the conversation, tools, memory and approvals all belong to
the same place.

It runs on your machine. Your conversations, memories, files and audit trail are JSON on
your disk. There is no account, no proxy, no telemetry.

<p align="center">
  <img src="assets/world.png" alt="A companion orb lit over a dark sea of particles" width="860">
</p>

> **Status:** v0.1 — usable daily, still moving fast. APIs and file formats may change
> between releases.

---

## Talk, don't type

Press **Ctrl+Shift+Space** once. The companion opens, the microphone stays live, and the
conversation continues without another key press.

- **It speaks while it writes.** Each finished sentence is synthesized and queued while
  the rest of the answer is still streaming, so the voice starts before the paragraph
  ends.
- **Talk over it.** Start speaking and it stops mid-word, keeps what you said, and
  answers that instead. Your words reach the run that is already working.
- **It keeps working while you talk.** Ask a follow-up mid-job and it takes the message
  at its next step — or, with a terminal agent that runs one process per turn, answers
  the moment the step lands.
- **One press ends it.** The microphone closes with the window, and never opens by
  itself on launch.

Push-to-talk is still there: hold **Space** in the panel for a single thought. The voice
is Microsoft's neural read-aloud engine with a local Windows voice underneath it, so the
app is never mute because a hosted key ran out.

## What's in the world

| | |
| --- | --- |
| **Companions with a mind each** | Every body can answer with its own provider and model. The pill above the chat switches the next reply for that companion only. |
| **Real hands** | Files, terminal, screen, mouse and keyboard, and the browser you are already signed into. Every consequential action is a card you approve. |
| **Memory that compounds** | Durable facts are written after the turn, corrected when you correct them, and inserted into the next prompt. Procedures that worked become skills. |
| **Documents you can cite** | Import PDF, DOCX, Markdown, text, CSV, HTML, JSON and code. Search runs on this machine; answers carry `[document, passage n]` citations. |
| **Diagrams that assemble** | The model writes a small graph, the renderer lays it out. Pan, zoom, click a node for its detail, open it full-window. Nothing is hard-coded per diagram. |
| **A world that reacts** | Work is handed to workers in view. Approvals, dispatches and arrivals are events in the same place as the conversation. |
| **A ledger, not a vibe** | Every tool call, decision and refusal is appended to an audit journal you can read. |
| **Routines and reminders** | "Every morning", "before the meeting", "remind me" become scheduled turns that keep working after a restart. |

## Live conversation

The companion is a frameless, always-on-top window — one press from listening and one
click from a compact thread. It is the same runtime, the same memory and the same
approvals as the main window, not a second app.

```text
        you speak                     it thinks                     it answers
   ┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
   │  mic stays open  │  ───▶  │  the run starts  │  ───▶  │  voice + text    │
   │  silence ends it │        │  tools may run   │        │  while it writes │
   └──────────────────┘        └──────────────────┘        └──────────────────┘
             ▲                                                        │
             └─────────────  it listens again, no key  ◀──────────────┘
```

Speaking over it is the interrupt. Pressing **Space** hushes it without ending the
conversation. **Esc** hides the window and closes the microphone.

## Quick start

```bash
npm install
npm run dev      # hot-reloading Electron + Vite
npm run build    # bundle main, preload and renderer into out/
npm start        # run the built app
```

Requires **Node 20+** and a desktop with WebGL 2.

Then open **Settings → Mind** and pick a provider. The offline demo agent works with no
key at all; the interesting version needs a model.

## Pick a mind

| Provider | Needs | Notes |
| --- | --- | --- |
| Mock | nothing | Offline demo agent. Proves the loop works. |
| OpenAI-compatible | base URL + key | OpenAI, OpenRouter, Groq, Together, vLLM, LM Studio. Full tool calling. |
| Ollama | a local model | `http://127.0.0.1:11434`. No key, no network. |
| CodeBuddy CLI | `codebuddy` on PATH | Runs Tencent's agent with `hy3` (or its default). Gets the browser and this app's own tools over MCP. |
| OpenCode CLI | `opencode` on PATH | Hands the turn to your existing agent, which brings its own tools. |
| Claude Code CLI | `claude` on PATH | Runs `claude -p`. |
| Codex CLI | `codex` on PATH | Runs `codex exec`. |
| Gemini CLI | `gemini` on PATH | Runs `gemini -p`. |
| Custom CLI | any command | Put `{prompt}` where the prompt goes, or pipe it on stdin. |

Keys are encrypted with the OS keychain (`safeStorage`). They never enter the renderer,
a log, or this repository.

## Give it hands

Settings → **Machine access**. Nothing outside the folders you grant is reachable: path
resolution happens in the main process after `realpath`, and every call is checked
against the allow-list.

```text
read_file · write_file · list_files · run_command
see_screen · guide_screen · desktop_look · desktop_click · desktop_type · desktop_key
browser_open · browser_read · browser_snapshot · browser_act · browser_run
remember · recall · documents_write · documents_search · create_skill
delegate_task · set_reminder · list_reminders · notify
```

- reads run without a prompt;
- writes, commands, clicks and keystrokes raise a card with the exact path or command;
- **Always allow** is per tool, per session;
- every decision is appended to `audit.jsonl` and visible under **Ledger**.

The screen tools are a permissioned still plus a click-through guide layer drawn over
your real display — numbered steps, a hole around the control, and one sentence beside
it. The layer ignores the mouse, so you can keep working underneath.

## The browser you are actually signed into

Vivarium speaks MCP to a local **BrowserOS neo** server. Its `browser_*` tools list your
tabs, read a page, snapshot controls, click, fill and run script — in the profile with
your logins, without copying cookies anywhere. Terminal agents launched by the app get
the same server in their MCP config, so they can act on the same tabs.

If the server is not running, the Integrations screen says so and how to fix it. Nothing
there is a fake **Connect** button.

## Any mind, one loop

Anything that can answer over OpenAI's protocol can drive the loop: local, hosted,
self-hosted, or a CLI agent with its own toolbox. The loop stays the same:

```text
system prompt ─┐
history ───────┴─▶ provider ─▶ text deltas ──────▶ UI + voice
                        │
                        └▶ tool calls ─▶ approval ─▶ execute ─┐
                                                             │
                          append the result and think again ◀─┘
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the contracts, and
[docs/BRAND.md](docs/BRAND.md) for the design system.

## Where your data lives

`app.getPath("userData")` — on Windows `%APPDATA%\Vivarium`:

```text
settings.json      provider, model, base URL, roots, accent
world.json         agents, personas, hues, positions
threads/main.json  the conversation
memory.json        facts the agent chose to keep
skills.json        procedures it learned
audit.jsonl        append-only action ledger
screenshots/       the last twenty screen stills
vault.json         imported documents and their passages
```

**Settings → Data → Export everything** writes a single dated JSON to your Downloads.
Delete that folder and the app is new again.

## How it is built

```text
src/main/      Electron main: providers, agent loop, tools, store, IPC
src/preload/   contextBridge surface (window.viv)
src/renderer/  React + three.js world, chat dock, panels, overlay
src/shared/    types shared by all three
docs/          architecture and brand
```

- **No renderer privileges.** Node lives in the main process; the renderer talks over a
  typed preload bridge.
- **Providers are adapters.** Each one is a small translation layer onto the same event
  stream — text, tool calls, usage, done.
- **No cloud.** There is no Vivarium backend and no telemetry.

## Contributing

Open an issue before a large change so the shape can be agreed first. Small patches with
a clear reason are always welcome. Run `npm run typecheck` before opening a pull request.

## Licence

**Apache-2.0** — see [LICENSE](LICENSE). Patent grant included; build on it.
