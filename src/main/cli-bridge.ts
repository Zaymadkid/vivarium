import fs from "node:fs";
import path from "node:path";
import type { AppBridge } from "./app-bridge";

/**
 * THE BROWSER THE CLI CAN ACTUALLY SEE.
 *
 * CodeBuddy (like Claude Code) brings its own tools but no browser. The signed-in
 * BrowserOS neo server speaks MCP on loopback, so the app writes a small MCP
 * config and hands it to the CLI at launch. That gives the mind the person's real
 * tabs and logins without copying cookies or asking them to sign in again.
 *
 * Allowed tools are limited to the MCP dispatcher and neo's own namespace:
 * shell, file writes and edits still pass through the approval bridge.
 */

let bridgeArgs: string[] = [];

/** Writes the per-install MCP config and records the argv for CLI providers. */
export function installCliBridge(dir: string, app?: AppBridge): void {
  const url = process.env.VIV_NEO_URL ?? "http://127.0.0.1:9210/mcp";
  const file = path.join(dir, "cli-mcp.json");
  const config = {
    mcpServers: {
      "browseros-neo": {
        type: "http",
        url,
      },
      ...(app
        ? {
            vivarium: {
              command: "node",
              args: [app.scriptPath],
              env: { VIV_MCP_URL: app.url, VIV_MCP_TOKEN: app.token },
            },
          }
        : {}),
    },
  };
  const shots = path.join(dir, "screenshots");
  const images = path.join(dir, "images");
  try {
    fs.mkdirSync(shots, { recursive: true });
    fs.mkdirSync(images, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2), "utf8");
    bridgeArgs = [
      "--mcp-config",
      file,
      // Stills and generated images live under the data folder; the CLI needs
      // those paths explicitly to read and write them.
      "--add-dir",
      shots,
      "--add-dir",
      images,
      // DeferExecuteTool is CodeBuddy's MCP dispatcher. Allowing it with the neo
      // namespace keeps browser actions working in a headless `-p` turn while
      // leaving Bash / Write / Edit on the approval hook. ViewImage is the
      // read-only way the CLI sees a screenshot the app already captured.
      "--allowedTools",
      "DeferExecuteTool",
      "mcp__browseros-neo__*",
      "mcp__vivarium__*",
      "Read",
      "ViewImage",
    ];
  } catch {
    // A read-only data folder costs the browser bridge, not the whole runtime.
    bridgeArgs = [];
  }
}

/** Extra argv for a CLI that can take an MCP config. Empty until installed. */
export function cliBridgeArgs(): string[] {
  return bridgeArgs;
}
