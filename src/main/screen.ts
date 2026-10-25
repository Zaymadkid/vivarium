import { desktopCapturer, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ScreenPreview } from "../shared/types";

/**
 * SEEING THIS MACHINE.
 *
 * Capture is deliberately small and local: the primary display, scaled to a
 * width a vision model can read without sending a 4K bitmap, JPEG at a quality
 * that keeps text legible. Nothing is captured until Settings → Machine access
 * lets her look, and every capture lands in the app's own data folder so the
 * person can see exactly what was taken.
 */

const MAX_WIDTH = 1600;
const KEEP = 20;

export interface Capture extends ScreenPreview {
  /** Absolute path of the saved still, for the ledger and the tool result. */
  path: string;
  /** Raw base64 JPEG, for providers that accept images. */
  base64: string;
}

export async function captureScreen(dataDir: string, save = true): Promise<Capture> {
  const primary = screen.getPrimaryDisplay();
  const ratio = primary.scaleFactor || 1;
  const width = Math.min(MAX_WIDTH, Math.round(primary.size.width * ratio));
  const height = Math.round((width / (primary.size.width * ratio)) * primary.size.height * ratio);

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
    fetchWindowIcons: false,
  });
  if (sources.length === 0) {
    throw new Error("This machine did not return a screen to capture.");
  }
  const source =
    sources.find((s) => s.display_id === String(primary.id)) ?? sources[0];
  const image = source.thumbnail;
  if (!image || image.isEmpty()) {
    throw new Error("The screen capture came back empty. Check screen-recording permission.");
  }

  const jpeg = image.toJPEG(82);
  let target = "";
  // A live view asks for a frame every second; that must not become twenty
  // files a minute on disk. Only a capture she is about to reason over is kept.
  if (save) {
    const dir = path.join(dataDir, "screenshots");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    target = path.join(dir, `screen-${stamp}.jpg`);
    fs.writeFileSync(target, jpeg);

    // A rolling window, not an archive: twenty stills is enough to look back on
    // and small enough that nobody has to clean up after her.
    try {
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.startsWith("screen-") && f.endsWith(".jpg"))
        .sort();
      for (const old of files.slice(0, Math.max(0, files.length - KEEP))) {
        fs.unlinkSync(path.join(dir, old));
      }
    } catch {
      // a locked file is not worth failing the capture over
    }
  }

  const size = image.getSize();
  return {
    dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
    base64: jpeg.toString("base64"),
    width: size.width,
    height: size.height,
    at: Date.now(),
    path: target,
  };
}
