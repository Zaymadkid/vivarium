import type { ReactNode } from "react";

/** The three lines every tool surface owes the reader. */
export function ToolBrief({
  does,
  connects,
  needs,
  note,
}: {
  does: ReactNode;
  connects: ReactNode;
  needs: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="tool-brief">
      <div>
        <span className="tb-label">What it does</span>
        <p>{does}</p>
      </div>
      <div>
        <span className="tb-label">What it connects to</span>
        <p>{connects}</p>
      </div>
      <div>
        <span className="tb-label">What it needs</span>
        <p>{needs}</p>
      </div>
      {note && <p className="tb-note">{note}</p>}
    </div>
  );
}
