"use client";

import { useRef } from "react";

type Component = { kind: string; label: string; weight: number; maxPoints: number };
const KIND: Record<string, string> = {
  QUIZ: "Quiz", ASSIGNMENT: "Assignment", PROJECT: "Project", MIDTERM: "Midterm", FINAL: "Final",
};

/** A button that opens the subject's (simulated) syllabus in a popup: components, weights and maxima. */
export default function SyllabusDialog({ name, version, simulated, components }: {
  name: string; version: number | null; simulated: boolean; components: Component[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const example = components.length
    ? `${components[0].label}: ${components[0].maxPoints * 0.75} of ${components[0].maxPoints} points × ${components[0].weight}% = ${(components[0].weight * 0.75).toFixed(2)} points`
    : null;
  return (
    <>
      <button type="button" className="button small" onClick={() => ref.current?.showModal()} data-testid="syllabus-open">
        Syllabus
      </button>
      <dialog ref={ref} className="dialog" aria-label={`Syllabus: ${name}`} onClick={(e) => e.target === ref.current && ref.current?.close()}>
        <div className="dialog-body">
          <h3>{name}</h3>
          <p className="muted">
            Syllabus v{version ?? "–"}{simulated && <> · <span className="pill">Simulated</span> BTU&apos;s syllabus isn&apos;t available, so this one is made up for the demo.</>}
          </p>
          <table className="table">
            <thead><tr><th>Component</th><th>Type</th><th>Weight</th><th>Marked out of</th></tr></thead>
            <tbody>
              {components.map((c) => (
                <tr key={c.label}><td>{c.label}</td><td>{KIND[c.kind] ?? c.kind}</td><td>{c.weight}%</td><td>{c.maxPoints}</td></tr>
              ))}
              <tr><td><strong>Total</strong></td><td></td><td><strong>{components.reduce((a, c) => a + c.weight, 0)}%</strong></td><td></td></tr>
            </tbody>
          </table>
          <p className="fine">
            Score = Σ weight × points ÷ maximum, out of 100.{example && <> Example: {example}.</>} Badge: 60+ Silver, 70+ Gold, 90+ Platinum.
          </p>
          <form method="dialog"><button className="button primary" type="submit">Close</button></form>
        </div>
      </dialog>
    </>
  );
}
