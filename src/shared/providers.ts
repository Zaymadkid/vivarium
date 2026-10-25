import type { ProviderInfo } from "./types";

/**
 * The catalogue the renderer paints. This is presentation data only: the actual
 * plugin implementations live in `src/main/providers.ts` and are resolved by id.
 * Adding a provider means adding one entry here and one `registerProvider()` call
 * there — no UI change.
 */
export const PROVIDER_CATALOG: ProviderInfo[] = [
  {
    id: "mock",
    label: "Mock (offline)",
    kind: "mock",
    requiresKey: false,
    supportsTools: true,
    defaultModel: "vivarium-mock-1",
    hint: "No network. Streams a deterministic answer and can call tools, so the loop is visible.",
    models: ["vivarium-mock-1"],
  },
  {
    id: "openai",
    label: "OpenAI-compatible",
    kind: "http",
    requiresKey: true,
    supportsTools: true,
    defaultModel: "gpt-4o-mini",
    hint: "OpenAI, OpenRouter, Groq, vLLM, LM Studio, Together — anything with /v1/chat/completions.",
    models: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "http",
    requiresKey: false,
    supportsTools: false,
    defaultModel: "llama3.2",
    hint: "Runs on your machine at 127.0.0.1:11434. No key, no network.",
    models: ["llama3.2", "qwen2.5", "mistral"],
  },
  {
    id: "codebuddy",
    label: "CodeBuddy CLI",
    kind: "cli",
    requiresKey: false,
    supportsTools: false,
    defaultModel: "hy3",
    hint: "Hands the turn to Tencent's `codebuddy` agent. It brings its own tools, files and shell access.",
    models: ["hy3", "default"],
  },
  {
    id: "opencode",
    label: "OpenCode CLI",
    kind: "cli",
    requiresKey: false,
    supportsTools: false,
    defaultModel: "default",
    hint: "Hands the turn to the `opencode` agent you already run. It brings its own tools.",
    models: ["default"],
  },
  {
    id: "claude",
    label: "Claude Code CLI",
    kind: "cli",
    requiresKey: false,
    supportsTools: false,
    defaultModel: "default",
    hint: "`claude -p` in your project folder, streamed into the world.",
    models: ["default"],
  },
  {
    id: "codex",
    label: "Codex CLI",
    kind: "cli",
    requiresKey: false,
    supportsTools: false,
    defaultModel: "default",
    hint: "`codex exec` — OpenAI's terminal agent.",
    models: ["default"],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    kind: "cli",
    requiresKey: false,
    supportsTools: false,
    defaultModel: "default",
    hint: "`gemini -p` — Google's terminal agent.",
    models: ["default"],
  },
  {
    id: "custom-cli",
    label: "Custom CLI",
    kind: "cli",
    requiresKey: false,
    supportsTools: false,
    defaultModel: "default",
    hint: "Any command. Use {prompt} where the prompt goes, or it is piped to stdin.",
    models: ["default"],
  },
];

export function providerInfo(id: string): ProviderInfo {
  return PROVIDER_CATALOG.find((p) => p.id === id) ?? PROVIDER_CATALOG[0];
}
