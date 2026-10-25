# Architecture

## Shape

```
┌──────────────────────────── Electron main (Node) ────────────────────────────┐
│  agent loop · provider adapters · tool host · memory · settings · audit log   │
│  ────────────────────────────────────────────────────────┬───────────────────  │
│                                                  typed IPC (preload bridge)   │
└──────────────────────────────────────────────────────────┼───────────────────┘
                                                           │
┌──────────────────────────── Renderer (React) ────────────┴───────────────────┐
│  World (three.js)   Chat dock   Agents   Memory   Settings   Approval cards  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Electron was chosen over Tauri because the machine has no Rust toolchain and every
contributor to an open-source desktop app already has Node. The main/preload/renderer
split is deliberately Tauri-shaped (capabilities, typed IPC, no node in the renderer)
so the shell can be swapped later without touching the product code.

## Boundaries

| Concern | Lives in | Never in |
| --- | --- | --- |
| API keys | main, OS keychain via `safeStorage` | renderer, logs |
| Tool execution | main | renderer |
| Provider HTTP/CLI | main | renderer |
| Rendering, input | renderer | main |
| File access | main, allow-listed roots | renderer |

The renderer gets **no** filesystem, shell, or network primitives. It can only call the
named methods on `window.viv`.

## The agent loop

```
user turn
  → build context (system + persona + recalled memory + last N messages)
  → provider.stream(messages, tools)
      ← text deltas                          → renderer (streaming)
      ← tool_call(name, args)
          → approval gate (if the tool is marked dangerous)
          → execute in main
          → append tool result, loop (max 8 hops)
  → persist turn, extract memory candidates
  → emit audit entry for every executed tool
```

Cancellation is cooperative: a run id is registered before the first hop and the
provider stream checks it between chunks.

## Provider contract

A provider is a module that can stream chat completions. Adding one is a single file
plus a settings entry.

```ts
export interface ProviderContext {
  messages: ChatMessage[]
  tools?: ToolSpec[]
  model: string
  signal: AbortSignal
  config: Record<string, unknown>   // baseUrl, apiKey, command, args…
}

export interface ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'done'; usage?: { in: number; out: number } }
  | { type: 'error'; message: string }

export interface Provider {
  id: string
  label: string
  kind: 'http' | 'cli' | 'mock'
  requiresKey: boolean
  supportsTools: boolean
  stream(ctx: ProviderContext): AsyncIterable<ProviderEvent>
}
```

Built-in adapters:

| id | kind | notes |
| --- | --- | --- |
| `openai` | http | any OpenAI-compatible `/v1/chat/completions`, streaming + function calling |
| `ollama` | http | native `/api/chat` NDJSON, no key |
| `opencode` | cli | `opencode run --print`, streams stdout |
| `claude` | cli | `claude -p --output-format stream-json` |
| `codex` | cli | `codex exec` |
| `gemini` | cli | `gemini -p` |
| `mock` | mock | deterministic offline agent, used by tests and first run |

CLI providers inherit their own tool loop. That is the point: **plug in the agent you
already use** and give it a world, memory and a face.

## Tool contract

```ts
export interface ToolSpec {
  name: string
  description: string
  parameters: JSONSchema
  danger: 'read' | 'write' | 'exec'
}
```

v0 tools: `list_files`, `read_file`, `write_file`, `run_command`, `remember`,
`recall`. Path tools are confined to allow-listed roots; `write_file` and
`run_command` always raise an approval card. Every execution is appended to
`audit.jsonl`.

## Data model

Everything is plain JSON under `%APPDATA%/Vivarium` so it can be inspected, diffed,
backed up, and exported without a database.

```
settings.json      provider config (keys encrypted via safeStorage), theme, roots
world.json         agents, positions, orb styles
threads/<id>.json  conversation history
memory.json        facts with source + timestamp
audit.jsonl        append-only tool log
```

`v1` moves memory to SQLite + a local embedding index; the file format above is the
migration source.

## World renderer

Plain three.js, no framework binding:

- one `InstancedMesh` of icospheres for every agent (one draw call)
- additive sprite halos generated at runtime from a radial-gradient canvas
- a low-opacity grid as the ground plane, fog to hide the horizon
- a starfield `Points` cloud for depth
- camera orbits on drag, zooms on wheel, focus animates toward the selected orb
- agent state drives colour temperature and pulse rate (idle / thinking / blocked / error)

Nothing is loaded from disk: the entire look is generated code, so the project ships
zero binary art and stays diff-friendly.

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- preload exposes a fixed, typed surface; no `ipcRenderer` passthrough
- navigation and `window.open` are denied by default
- file tools resolve and re-check containment after `realpath` (symlink-safe)
- shell execution is per-command approved, with the exact string shown on the card
- keys are encrypted with the OS keychain; they never enter the renderer
