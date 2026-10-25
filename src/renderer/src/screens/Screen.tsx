import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenPreview } from "../../../shared/types";
import { Icon } from "../shell/icons";
import { ToolBrief } from "../shell/Brief";
import { Chip, Empty } from "../shell/ui";
import { pushToast } from "../shell/toasts";

/**
 * THE LIVE SCREEN.
 *
 * She used to look at a still, and the person could only watch her look. This is
 * the other direction: a live frame of the real display, and a cursor that can
 * actually land on it. Clicking the picture clicks the desktop; the bar below
 * types into the window you picked. Nothing is stored: the frames are not
 * written to disk, unlike the stills she reasons over.
 *
 * The window picker exists because a click needs a target: send it to the app
 * that should receive it, and that app comes forward first.
 */

interface ProbeWindow {
  title: string;
  process: string;
  handle: number;
}

const KEYS: { label: string; keys: string }[] = [
  { label: "Enter", keys: "ENTER" },
  { label: "Tab", keys: "TAB" },
  { label: "Esc", keys: "ESC" },
  { label: "Ctrl+S", keys: "CTRL+S" },
];

export function ScreenScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const [frame, setFrame] = useState<ScreenPreview | null>(null);
  const [windows, setWindows] = useState<ProbeWindow[]>([]);
  const [target, setTarget] = useState("");
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [handsOn, setHandsOn] = useState<boolean | null>(null);
  const [text, setText] = useState("");
  const [submit, setSubmit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mark, setMark] = useState<{ x: number; y: number } | null>(null);
  // A real video track is smoother than twenty stills a minute and costs less:
  // Chromium shares the display, it does not hand over a new JPEG each tick.
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const polling = useRef(false);

  const loadWindows = useCallback(async () => {
    try {
      const rows = await window.viv.screen.windows();
      const usable = rows.filter((row) => row.title && row.title !== "Vivarium" && !/^Vivarium/i.test(row.title));
      setWindows(usable);
      setTarget((current) => (current && usable.some((row) => row.title === current) ? current : usable[0]?.title ?? ""));
    } catch {
      setWindows([]);
    }
  }, []);

  const grab = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const next = await window.viv.screen.live();
      setFrame(next);
      setError(null);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      polling.current = false;
    }
  }, []);

  const stopVideo = useCallback(() => {
    setStream((current) => {
      current?.getTracks().forEach((track) => track.stop());
      return null;
    });
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startVideo = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) return;
    try {
      const next = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } },
        audio: false,
      });
      setStream(next);
      setError(null);
      next.getVideoTracks()[0]?.addEventListener("ended", () => setStream(null));
    } catch {
      // A refused share is not a broken screen: the still frames keep coming.
      setStream(null);
    }
  }, []);

  useEffect(() => {
    void window.viv.settings.get().then((settings) => setHandsOn(Boolean(settings.abilities?.hands)));
    void grab();
    void loadWindows();
  }, [grab, loadWindows]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [stream]);

  useEffect(() => () => stopVideo(), [stopVideo]);

  useEffect(() => {
    if (!live) {
      stopVideo();
      return;
    }
    void startVideo();
    return stopVideo;
  }, [live, startVideo, stopVideo]);

  useEffect(() => {
    // Stills are the floor: only poll when the video track is not available.
    if (!live || stream) return;
    const timer = window.setInterval(() => void grab(), 1400);
    return () => window.clearInterval(timer);
  }, [live, stream, grab]);

  const disabled = handsOn === false;

  const click = async (event: React.MouseEvent<HTMLImageElement | HTMLVideoElement>) => {
    if (disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    setMark({ x: fx, y: fy });
    try {
      const result = await window.viv.screen.click(fx, fy, target || undefined);
      pushToast({ title: "Clicked", body: `${result.window} · ${result.x}, ${result.y}`, tone: "ok" });
      window.setTimeout(() => void grab(), 450);
    } catch (err) {
      pushToast({ title: "That click did not land", body: String(err instanceof Error ? err.message : err), tone: "bad" });
    }
  };

  const sendText = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await window.viv.screen.type(text, submit, target || undefined);
      setText("");
      pushToast({ title: submit ? "Typed and sent" : "Typed", body: target || "the front window", tone: "ok" });
      window.setTimeout(() => void grab(), 350);
    } catch (err) {
      pushToast({ title: "Typing failed", body: String(err instanceof Error ? err.message : err), tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  const press = async (keys: string) => {
    try {
      await window.viv.screen.key(keys, target || undefined);
      pushToast({ title: `Pressed ${keys}`, body: target || "the front window", tone: "ok" });
      window.setTimeout(() => void grab(), 350);
    } catch (err) {
      pushToast({ title: "That key did not land", body: String(err instanceof Error ? err.message : err), tone: "bad" });
    }
  };

  return (
    <section className="screen" aria-label="Screen">
      <header className="screen-head">
        <div className="screen-head-main">
          <h1 className="screen-title">Screen</h1>
          <p className="screen-sub">
            {stream
              ? `live video · ${live ? "streaming" : "paused"}`
              : frame
                ? `${frame.width}×${frame.height} · ${live ? "live" : "paused"}`
                : "looking at your display"}
            {target ? ` · aiming at ${target}` : ""}
          </p>
        </div>
        <div className="screen-actions">
          <Chip tone={live ? "live" : "idle"}>{live ? "live" : "paused"}</Chip>
          <button className="btn sm" onClick={() => void window.viv.screen.ask()} title="Point and ask — Ctrl+Shift+T">
            <Icon name="target" size={12} />
            Ask at cursor
          </button>
          <button
            className="btn sm"
            onClick={() => {
              setLive((value) => !value);
              void grab();
            }}
          >
            <Icon name={live ? "pause" : "play"} size={12} />
            {live ? "Pause" : "Go live"}
          </button>
        </div>
      </header>

      <div className="screen-body">
        <ToolBrief
          does="Shows your real display and lets you click or type on it from here."
          connects="A click goes to the window you pick, after that window comes forward. Typing pastes into its focused field."
          needs={
            disabled
              ? "Control this computer has to be on in Settings → Machine access. The picture is still live without it."
              : "The window you pick is brought forward before the action lands. Nothing leaves this PC."
          }
          note="Frames on this screen are never written to disk. The stills she looks at for a task still go to the app's screenshots folder."
        />

        {disabled && (
          <div className="screen-locked">
            <Icon name="lock" size={14} />
            <span>Control this computer is off, so clicks and keys will not land.</span>
            <button className="btn sm primary" onClick={() => onOpen("settings")}>
              Open Settings
            </button>
          </div>
        )}

        <div className="screen-bar">
          <label className="screen-target">
            <span>Aim at</span>
            <select value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Window to act on">
              {windows.length === 0 && <option value="">Front window</option>}
              {windows.map((row) => (
                <option key={`${row.handle}-${row.title}`} value={row.title}>
                  {row.title} · {row.process}
                </option>
              ))}
            </select>
          </label>
          <button className="btn sm" onClick={() => void loadWindows()}>
            <Icon name="refresh" size={12} />
            Windows
          </button>
          <button className="btn sm" onClick={() => void grab()}>
            <Icon name="refresh" size={12} />
            Frame
          </button>
        </div>

        <div className="screen-stage">
          {stream ? (
            <div className="screen-frame">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                onClick={(event) => void click(event)}
                className={disabled ? "no-control" : ""}
                aria-label="Your current display, live"
              />
              {mark && (
                <span
                  className="screen-mark"
                  style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}
                  aria-hidden
                />
              )}
            </div>
          ) : frame ? (
            <div className="screen-frame">
              <img
                src={frame.dataUrl}
                alt="Your current display"
                draggable={false}
                onClick={(event) => void click(event)}
                className={disabled ? "no-control" : ""}
              />
              {mark && (
                <span
                  className="screen-mark"
                  style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}
                  aria-hidden
                />
              )}
            </div>
          ) : (
            <Empty
              tight
              icon="screen"
              title={error ? "The display did not come through" : "Looking…"}
              body={error ?? "The first frame is on its way."}
              action={
                <button className="btn sm" onClick={() => void grab()}>
                  Try again
                </button>
              }
            />
          )}
        </div>

        <div className="screen-input">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={disabled ? "Turn on Control this computer to type" : "Type into the chosen window…"}
            aria-label="Text to type"
            disabled={disabled}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void sendText();
              }
            }}
          />
          <label className="screen-check">
            <input type="checkbox" checked={submit} onChange={(event) => setSubmit(event.target.checked)} />
            press Enter
          </label>
          <button className="btn sm primary" onClick={() => void sendText()} disabled={disabled || busy || !text.trim()}>
            {busy ? "Sending…" : "Type"}
          </button>
          {KEYS.map((key) => (
            <button key={key.keys} className="chipbtn" onClick={() => void press(key.keys)} disabled={disabled}>
              {key.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
