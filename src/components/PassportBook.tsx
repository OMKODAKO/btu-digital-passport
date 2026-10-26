"use client";

import "./passport-book.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BookData } from "@/lib/passport-book";
import {
  AchievementsPage, BackCoverFace, BlankBack, CoverFace, EvidencePage, IdentityPage, JourneyPage, NotesPage, SkillsPage,
  TOTAL_PAGES,
} from "./PassportBookPages";

/**
 * The passport as an interactive booklet: a closed cover that opens around the spine, leaves that turn one at a
 * time, and a back cover. Built with CSS 3D transforms only.
 *
 * Every leaf has two faces (front = a right-hand page, back = the left-hand page that follows it), so the reverse
 * of a turning leaf is always the next page, never a mirrored copy. Wide screens show two-page spreads
 * (4 leaves: cover|01, 02|03, 04|05, 06|back cover); narrow screens show one page at a time (one leaf per page,
 * plain paper on the reverse). `step` = how many leaves have been turned. Controls sit outside the turning pages.
 */

type Face = { node: ReactNode; label: string; pages: number[] };
type Leaf = { front: Face; back: Face };

const SPREAD_QUERY = "(min-width: 900px)";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const TURN_MS = 760;
const STAGGER_MS = 90;
const pad = (n: number) => String(n).padStart(2, "0");

function useMedia(query: string, initial: boolean) {
  const [match, setMatch] = useState(initial);
  useEffect(() => {
    const m = window.matchMedia(query);
    setMatch(m.matches);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** spread step <-> single-page step, so switching layout keeps the reader on the same page */
const spreadToSingle = (s: number) => (s >= 4 ? 7 : Math.max(0, 2 * s - 1));
const singleToSpread = (s: number) => Math.ceil(s / 2);

export default function PassportBook({ data, homeHref = "/", homeLabel = "Back to home" }: {
  data: BookData; homeHref?: string; homeLabel?: string;
}) {
  const spread = useMedia(SPREAD_QUERY, true);
  const reduced = useMedia(REDUCED_QUERY, false);
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);
  const [selected, setSelected] = useState<string | null>(data.skills[0]?.id ?? null);
  const [turning, setTurning] = useState<Record<number, { delay: number; z: number }>>({});
  const [instant, setInstant] = useState(true); // no transitions on first paint and when the layout switches
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const go = useCallback(
    (target: number) => {
      const from = stepRef.current;
      const max = spread ? 4 : 7;
      const to = Math.max(0, Math.min(max, target));
      if (to === from) return;
      const changed = to > from ? range(from, to) : range(to, from).reverse();
      const stagger = reduced ? 0 : STAGGER_MS;
      const next: Record<number, { delay: number; z: number }> = {};
      changed.forEach((leaf, i) => (next[leaf] = { delay: i * stagger, z: 100 + ++seq.current }));
      setInstant(false);
      setTurning((t) => ({ ...t, ...next }));
      stepRef.current = to;
      setStep(to);
      const done = reduced ? 0 : TURN_MS + (changed.length - 1) * stagger + 40;
      const token = seq.current;
      timers.current.push(
        window.setTimeout(() => {
          setTurning((t) => {
            const left = { ...t };
            for (const leaf of changed) if (left[leaf] && left[leaf].z <= 100 + token) delete left[leaf];
            return left;
          });
        }, done),
      );
    },
    [spread, reduced],
  );

  const skill = data.skills.find((k) => k.id === selected) ?? null;
  const open = useCallback(() => go(1), [go]);

  const faces = useMemo(() => {
    const f = (node: ReactNode, label: string, pages: number[] = []): Face => ({ node, label, pages });
    return {
      cover: f(<CoverFace data={data} closed={step === 0} onOpen={open} />, "Cover"),
      p1: f(<IdentityPage data={data} />, "Identity", [1]),
      p2: f(<JourneyPage data={data} />, "Academic journey", [2]),
      p3: f(<SkillsPage data={data} selected={selected} onSelect={setSelected} single={!spread} />, "Skills", [3]),
      p4: f(<EvidencePage data={data} skill={skill} onSelect={setSelected} />, "Evidence", [4]),
      p5: f(<AchievementsPage data={data} />, "Achievements and verification", [5]),
      p6: f(<NotesPage data={data} />, "About this passport", [6]),
      back: f(<BackCoverFace data={data} />, "Back cover"),
    };
  }, [data, step === 0, open, selected, skill, spread]); // eslint-disable-line react-hooks/exhaustive-deps

  const leaves: Leaf[] = useMemo(() => {
    if (spread) {
      return [
        { front: faces.cover, back: faces.p1 },
        { front: faces.p2, back: faces.p3 },
        { front: faces.p4, back: faces.p5 },
        { front: faces.p6, back: faces.back },
      ];
    }
    const blank = { node: <BlankBack />, label: "", pages: [] };
    return [faces.cover, faces.p1, faces.p2, faces.p3, faces.p4, faces.p5, faces.p6, faces.back].map((front) => ({ front, back: blank }));
  }, [faces, spread]);

  // spreads: every leaf can turn (the last shows the back cover); single pages: the back cover is the last page
  const maxStep = spread ? leaves.length : leaves.length - 1;

  // keep the reader on the same page when the layout switches between spreads and single pages
  const lastSpread = useRef(spread);
  useEffect(() => {
    if (lastSpread.current === spread) return;
    const s = spread ? singleToSpread(stepRef.current) : spreadToSingle(stepRef.current);
    lastSpread.current = spread;
    stepRef.current = s;
    setInstant(true);
    setTurning({});
    setStep(s);
  }, [spread]);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((id) => window.clearTimeout(id));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(stepRef.current + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(stepRef.current - 1); }
      else if (e.key === "Escape" && stepRef.current !== 0) go(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // which faces can be seen (and so read, focused and clicked) at this step
  const visible = new Set<Face>();
  if (spread) {
    if (step > 0) visible.add(leaves[step - 1].back);
    if (step < leaves.length) visible.add(leaves[step].front);
  } else visible.add(leaves[step].front);
  const shown = leaves.flatMap((l) => [l.front, l.back]).filter((f) => visible.has(f) && f.label);
  const pages = shown.flatMap((f) => f.pages);
  const counter =
    step === 0 ? "Cover" : step === maxStep ? "Back cover" : pages.length > 1 ? `${pad(pages[0])}–${pad(pages[1])} / ${pad(TOTAL_PAGES)}` : `${pad(pages[0])} / ${pad(TOTAL_PAGES)}`;
  const sectionName = shown.map((f) => f.label).join(" · ");
  const state = step === 0 ? "closed-front" : step === maxStep ? "closed-back" : "open";

  const sections = [
    { label: "Identity", page: 1 }, { label: "Journey", page: 2 }, { label: "Skills", page: 3 },
    { label: "Evidence", page: 4 }, { label: "Achievements", page: 5 }, { label: "Notes", page: 6 },
  ];
  const stepForPage = (p: number) => (spread ? Math.ceil(p / 2) : p);

  return (
    <div
      className={`pb ${spread ? "pb-spread" : "pb-single"} ${reduced ? "pb-reduced" : ""} ${instant ? "pb-instant" : ""}`}
      data-testid="passport-book"
      data-state={state}
      data-step={step}
      data-layout={spread ? "spread" : "single"}
    >
      <div
        className="pb-scene"
        role="region"
        aria-roledescription="passport booklet"
        aria-label={`AI Skills Digital Passport${data.demoLabel ? ` (${data.demoLabel})` : ""}`}
        onPointerDown={(e) => { if (e.pointerType !== "mouse") touch.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t) return;
          const dx = e.clientX - t.x;
          const dy = e.clientY - t.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(stepRef.current + (dx < 0 ? 1 : -1));
        }}
        onPointerCancel={() => (touch.current = null)}
      >
        <div className="pb-book">
          {spread && (
            <div className={`pb-stack pb-stack-left ${step > 0 ? "" : "is-empty"}`} style={{ boxShadow: edges(Math.max(1, step), -1) }} aria-hidden="true" />
          )}
          <div className={`pb-stack pb-stack-right ${step < leaves.length ? "" : "is-empty"}`}
            style={{ boxShadow: edges(Math.max(1, leaves.length - step), 1) }} aria-hidden="true" />
          {leaves.map((leaf, i) => {
            const flipped = i < step;
            const t = turning[i];
            const z = t ? t.z : flipped ? i + 1 : leaves.length - i + 1;
            return (
              <div
                key={i}
                className={`pb-leaf ${flipped ? "is-flipped" : ""} ${t ? "is-turning" : ""} ${i === 0 ? "pb-leaf-cover" : ""} ${spread && i === leaves.length - 1 ? "pb-leaf-backcover" : ""}`}
                style={{ zIndex: z, transitionDelay: t ? `${t.delay}ms` : undefined, ["--d" as string]: t ? `${t.delay}ms` : "0ms" }}
                data-leaf={i}
              >
                <div className="pb-face pb-front" inert={!visible.has(leaf.front)} aria-hidden={!visible.has(leaf.front)}>
                  {leaf.front.node}
                  <span className="pb-shade" aria-hidden="true" />
                </div>
                <div className="pb-face pb-back" inert={!visible.has(leaf.back)} aria-hidden={!visible.has(leaf.back)}>
                  {leaf.back.node}
                  <span className="pb-shade" aria-hidden="true" />
                </div>
              </div>
            );
          })}
          {step > 0 && step < maxStep && (
            <button type="button" className="pb-edge pb-edge-prev" tabIndex={-1} aria-hidden="true" onClick={() => go(step - 1)} />
          )}
          {step > 0 && step < maxStep && (
            <button type="button" className="pb-edge pb-edge-next" tabIndex={-1} aria-hidden="true" onClick={() => go(step + 1)} />
          )}
        </div>
      </div>

      <nav className="pb-controls" aria-label="Passport navigation">
        <a className="pb-ctl pb-ctl-link" href={homeHref}>← {homeLabel}</a>
        <div className="pb-ctl-group">
          <button type="button" className="pb-ctl" onClick={() => go(step - 1)} disabled={step === 0} aria-label="Previous page"
            data-testid="book-prev">
            ‹ <span className="pb-ctl-text">Previous</span>
          </button>
          <p className="pb-counter" data-testid="book-counter">
            <span className="pb-counter-n">{counter}</span>
            <span className="pb-counter-name">{step === 0 || step === maxStep ? "" : sectionName}</span>
          </p>
          <button type="button" className="pb-ctl" onClick={() => go(step + 1)} disabled={step === maxStep} aria-label="Next page"
            data-testid="book-next">
            <span className="pb-ctl-text">{step === 0 ? "Open" : "Next"}</span> ›
          </button>
        </div>
        <button type="button" className="pb-ctl" onClick={() => go(0)} disabled={step === 0} data-testid="book-close">
          Close passport
        </button>
      </nav>
      <ol className="pb-tabs" aria-label="Passport pages">
        {sections.map((s) => {
          const target = stepForPage(s.page);
          const current = pages.includes(s.page);
          return (
            <li key={s.page}>
              <button type="button" onClick={() => go(target)} aria-current={current ? "page" : undefined}>
                <span className="pb-mono">{pad(s.page)}</span> {s.label}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="pb-sr" aria-live="polite">
        {step === 0 ? "Passport closed." : step === maxStep ? "Back cover." : `Showing ${sectionName}, ${counter}.`}
      </p>
    </div>
  );
}

function range(a: number, b: number) {
  return Array.from({ length: b - a }, (_, i) => a + i);
}

/** Layered paper edges for a block of `n` leaves on one side (dir 1 = right, -1 = left), plus its shadow. */
function edges(n: number, dir: 1 | -1) {
  const layers = Array.from({ length: Math.min(6, n + 1) }, (_, i) => {
    const k = i + 1;
    return `${dir * k}px ${k * 0.7}px 0 ${i % 2 ? "#d8cdb3" : "#efe7d4"}`;
  });
  return [...layers, `${dir * 10}px 16px 26px rgba(20, 16, 8, 0.28)`].join(", ");
}
