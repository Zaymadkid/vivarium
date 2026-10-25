import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import "./surfaces.css";
import "./hud.css";
import "./brain.css";
import "./settings.css";
import "./overlay.css";
import "./guide.css";

/**
 * One build, two windows. `#overlay` is the always-on-top Knot: it must not pay
 * for the world's 3D scene, so the app itself is a dynamic import. The main
 * window keeps the same entry it always had.
 */
const overlayMode = window.location.hash.includes("overlay");
const guideMode = window.location.hash.includes("guide");
document.documentElement.classList.toggle("overlay-mode", overlayMode);
document.documentElement.classList.toggle("guide-mode", guideMode);

const root = ReactDOM.createRoot(document.getElementById("root")!);

const failed = (err: unknown) => {
  root.render(
    <div className="boot" style={{ background: "transparent" }}>
      <span>This window could not start.</span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 10, opacity: 0.7 }}>
        {err instanceof Error ? err.message : String(err)}
      </span>
    </div>,
  );
};

if (guideMode) {
  void import("./Guide")
    .then(({ Guide }) => root.render(<Guide />))
    .catch(failed);
} else if (overlayMode) {
  void import("./Overlay")
    .then(({ Overlay }) => root.render(<Overlay />))
    .catch(failed);
} else {
  void import("./App")
    .then(({ default: App }) =>
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      ),
    )
    .catch(failed);
}
