import type { ReactNode } from "react";

/**
 * The frame of BTU's passport template around a page: charcoal background, the "university-wide
 * initiative" line on top and the university's name at the bottom. Pages put white `.lp-sheet`s inside.
 */
export default function PassportFrame({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <main className="landing">
      <div className="lp-frame">
        <p className="lp-initiative">A university-wide initiative of Business and Technology University (BTU)</p>
        {children}
        <footer className="lp-foot">
          <span>Business and Technology University</span>
          {note && <span className="lp-foot-note">{note}</span>}
        </footer>
      </div>
    </main>
  );
}
