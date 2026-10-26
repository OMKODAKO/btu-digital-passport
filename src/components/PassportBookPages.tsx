"use client";

import type { ReactNode } from "react";
import type { BookData, BookEvidence, BookSkill } from "@/lib/passport-book";
import type { Tier } from "@/lib/subjects";

/* The content of each face of the passport booklet. Pure rendering: navigation lives in PassportBook. */

export const TOTAL_PAGES = 6;
const pad = (n: number) => String(n).padStart(2, "0");

/** A rosette of rotated ellipses: the fine guilloche line work on the covers and the emblem. */
export function Rosette({ r = 46, petals = 18, className }: { r?: number; petals?: number; className?: string }) {
  return (
    <g className={className} fill="none">
      {Array.from({ length: petals }, (_, i) => (
        <ellipse key={i} cx="0" cy="0" rx={r} ry={r * 0.38} transform={`rotate(${(180 / petals) * i})`} />
      ))}
    </g>
  );
}

export function Emblem({ size = 132 }: { size?: number }) {
  return (
    <svg className="pb-emblem" width={size} height={size} viewBox="-60 -60 120 120" aria-hidden="true">
      <circle r="57" className="pb-emblem-ring" />
      <circle r="52" className="pb-emblem-ring pb-thin" />
      <Rosette r={46} petals={20} className="pb-emblem-lines" />
      <circle r="21" className="pb-emblem-core" />
      <text y="7" textAnchor="middle" className="pb-emblem-text">AI</text>
      {Array.from({ length: 3 }, (_, i) => (
        <text key={i} x={Math.cos((-90 + i * 120) * (Math.PI / 180)) * 37} y={Math.sin((-90 + i * 120) * (Math.PI / 180)) * 37 + 5}
          textAnchor="middle" className="pb-emblem-star">✱</text>
      ))}
    </svg>
  );
}

const TIER_COLOR: Record<Tier, string> = { SILVER: "silver", GOLD: "gold", PLATINUM: "platinum" };
const categoryClass = (s: string) => (/advanced/i.test(s) ? "advanced" : /applied/i.test(s) ? "applied" : "skill");

/** A small seal: tier colour for scored subjects, the stamp colour of the category for sheet skills. */
export function Seal({ tier, category, size = 30 }: { tier: Tier | null; category?: string; size?: number }) {
  const tone = tier ? `tier-${TIER_COLOR[tier]}` : category ? `cat-${categoryClass(category)}` : "none";
  return (
    <svg className={`pb-seal pb-seal-${tone}`} width={size} height={size} viewBox="-20 -20 40 40" aria-hidden="true">
      <circle r="18.5" />
      <Rosette r={14} petals={10} className="pb-seal-lines" />
      <text y="4.5" textAnchor="middle">{tier ? tier[0] : "✱"}</text>
    </svg>
  );
}

function Sheet({ n, title, ka, demo, children, reference }: {
  n: number; title: string; ka: string; demo: string | null; reference: string; children: ReactNode;
}) {
  return (
    <div className="pb-sheet">
      <header className="pb-running">
        <span>AI Skills Digital Passport</span>
        <span className="pb-pageno" aria-label={`Page ${pad(n)} of ${pad(TOTAL_PAGES)}`}>{pad(n)}</span>
      </header>
      <h3 className="pb-title">
        {title} <span lang="ka">{ka}</span>
      </h3>
      <div className="pb-body">{children}</div>
      <footer className="pb-foot">
        {demo ? <span className="pb-demo-tag" data-testid="book-demo-label">{demo}</span> : <span>Business and Technology University</span>}
        <span className="pb-mono">{reference}</span>
      </footer>
    </div>
  );
}

export function CoverFace({ data, closed, onOpen }: { data: BookData; closed: boolean; onOpen: () => void }) {
  const inner = (
    <>
      <span className="pb-cover-top">Business and Technology University</span>
      <Emblem />
      <span className="pb-cover-title">
        <strong>AI Skills</strong> Digital Passport
      </span>
      <span className="pb-cover-sub">
        Digital Skills Passport · <span lang="ka">ციფრული უნარების პასპორტი</span>
      </span>
      {data.demoLabel && <span className="pb-cover-demo">{data.demoLabel}</span>}
      <span className="pb-cover-hint" aria-hidden={!closed}>Open your passport</span>
    </>
  );
  return (
    <div className="pb-cover">
      <svg className="pb-cover-guilloche" viewBox="-100 -72 200 284" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
        <Rosette r={118} petals={40} />
        <circle r="128" fill="none" />
        <circle r="131" fill="none" />
      </svg>
      {closed ? (
        <button type="button" className="pb-cover-inner pb-cover-button" onClick={onOpen} data-testid="book-cover">
          <span className="pb-sr">Open your passport. </span>
          {inner}
        </button>
      ) : (
        <div className="pb-cover-inner">{inner}</div>
      )}
    </div>
  );
}

export function BackCoverFace({ data }: { data: BookData }) {
  return (
    <div className="pb-cover pb-cover-back">
      <svg className="pb-cover-guilloche" viewBox="-100 -72 200 284" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
        <Rosette r={118} petals={40} />
        <circle r="128" fill="none" />
        <circle r="131" fill="none" />
      </svg>
      <div className="pb-cover-inner">
        <Emblem size={112} />
        <span className="pb-back-name">AI Skills Digital Passport</span>
        <span className="pb-cover-top">Business and Technology University</span>
        <span className="pb-back-verify">
          {data.issue.verificationCode ? (
            <>
              Verification code <span className="pb-mono">{data.issue.verificationCode}</span>
              <br />
              Check it on the portal&apos;s public verification page.
            </>
          ) : data.illustrative ? (
            "Demo booklet: no verification record exists for it."
          ) : (
            "This version has no blockchain record to verify."
          )}
        </span>
      </div>
    </div>
  );
}

export function IdentityPage({ data }: { data: BookData }) {
  const h = data.holder;
  const initials = h.fullName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  const rows: [string, string | null][] = [
    ["Full name", h.fullName],
    ["Academic programme", h.program],
    ["Level", h.level],
    ["Study year", h.studyYear],
    ["Passport reference", h.reference],
  ];
  return (
    <Sheet n={1} title="Identity" ka="იდენტობა" demo={data.demoLabel} reference={h.reference}>
      <div className="pb-identity">
        <div className="pb-portrait" aria-hidden="true">
          <svg viewBox="-50 -60 100 120"><Rosette r={44} petals={14} /></svg>
          <span>{initials}</span>
        </div>
        <dl className="pb-fields">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className={v ? undefined : "pb-missing"} data-testid={`book-${k.toLowerCase().replaceAll(" ", "-")}`}>
                {v ?? "Not recorded"}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="pb-note">
        The holder&apos;s email and student number are never printed in this booklet.
      </p>
    </Sheet>
  );
}

export function JourneyPage({ data }: { data: BookData }) {
  const { subjects, summary } = data.journey;
  return (
    <Sheet n={2} title="Academic journey" ka="აკადემიური გზა" demo={data.demoLabel} reference={data.holder.reference}>
      <p className="pb-lead">{summary}</p>
      {subjects.length ? (
        <table className="pb-table">
          <thead>
            <tr>
              <th scope="col">Subject</th>
              <th scope="col">Grade</th>
              <th scope="col">ECTS</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((s) => (
              <tr key={s.code}>
                <th scope="row">
                  {s.nameEn}
                  <span lang="ka">{s.nameKa}</span>
                </th>
                <td>
                  {s.grade ? <span className="pb-mono">{s.grade}</span> : <span className="pb-missing">{s.status}</span>}
                </td>
                <td className="pb-mono">{s.credits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="pb-missing">No subject results yet.</p>
      )}
      <p className="pb-note">Grade = subject score out of 100. Only subjects that count toward the AI passport are shown.</p>
    </Sheet>
  );
}

export function SkillsPage({ data, selected, onSelect, single }: {
  data: BookData; selected: string | null; onSelect: (id: string) => void; single: boolean;
}) {
  return (
    <Sheet n={3} title="Skills" ka="უნარები" demo={data.demoLabel} reference={data.holder.reference}>
      <p className="pb-lead">
        Select a skill to inspect its evidence {single ? "on page 04" : "on the facing page"}.
      </p>
      <ul className="pb-skills">
        {data.skills.map((k) => (
          <li key={k.id}>
            <button type="button" className="pb-skill" aria-pressed={selected === k.id} onClick={() => onSelect(k.id)}
              data-testid="book-skill">
              <Seal tier={k.tier} category={k.tier ? undefined : k.area} />
              <span className="pb-skill-text">
                <span className="pb-skill-name">{k.name}</span>
                <span className="pb-skill-meta">
                  {k.area} · <b>{k.level}</b>
                </span>
              </span>
              {k.score && (
                <span className="pb-score" aria-label={`Score ${k.score} of 100`}>
                  <span className="pb-mono">{Number(k.score).toFixed(0)}</span>
                  <span className="pb-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Number(k.score))}%` }} /></span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {!data.skills.length && <p className="pb-missing">No skills recorded yet.</p>}
    </Sheet>
  );
}

function EvidenceGroup({ title, items, kind }: { title: string; items: BookEvidence[]; kind: BookEvidence["kind"] }) {
  if (!items.length) return null;
  return (
    <section className={`pb-ev-group pb-ev-${kind}`} aria-label={title}>
      <h4><span className="pb-ev-mark" aria-hidden="true" />{title}</h4>
      <ul>
        {items.map((e, i) => (
          <li key={i} data-testid={`book-evidence-${kind}`}>
            <span className="pb-ev-title">{e.title}</span>
            <span className="pb-ev-result pb-mono">{e.result}</span>
            <span className="pb-ev-why">{e.explanation}</span>
            <span className="pb-ev-source">{e.source}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function EvidencePage({ data, skill, onSelect }: { data: BookData; skill: BookSkill | null; onSelect: (id: string) => void }) {
  return (
    <Sheet n={4} title="Evidence" ka="მტკიცებულება" demo={data.demoLabel} reference={data.holder.reference}>
      {data.skills.length > 0 && (
        <label className="pb-ev-pick">
          <span>Skill</span>
          <select value={skill?.id ?? ""} onChange={(e) => onSelect(e.target.value)} data-testid="book-evidence-select">
            {data.skills.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>
        </label>
      )}
      {skill ? (
        <div className="pb-ev" aria-live="polite" data-testid="book-evidence" data-skill={skill.id}>
          <p className="pb-ev-head">
            <Seal tier={skill.tier} category={skill.tier ? undefined : skill.area} size={24} />
            <span>
              <strong>{skill.name}</strong> · {skill.level}
              {skill.score && <> · <span className="pb-mono">{skill.score}</span> / 100</>}
            </span>
          </p>
          <EvidenceGroup title="Academic grade evidence" kind="academic" items={skill.evidence.filter((e) => e.kind === "academic")} />
          <EvidenceGroup title="Practical project evidence" kind="practical" items={skill.evidence.filter((e) => e.kind === "practical")} />
        </div>
      ) : (
        <p className="pb-missing">No skills to show evidence for yet.</p>
      )}
      {data.illustrative && <p className="pb-note">Illustrative evidence for a fictional student. No backend record stands behind it.</p>}
    </Sheet>
  );
}

export function AchievementsPage({ data }: { data: BookData }) {
  const i = data.issue;
  return (
    <Sheet n={5} title="Achievements & verification" ka="მიღწევები" demo={data.demoLabel} reference={data.holder.reference}>
      {data.badges.length ? (
        <ul className="pb-badges">
          {data.badges.map((b) => (
            <li key={`${b.name}-${b.label}`} data-testid="book-badge">
              <Seal tier={b.tier} category={b.tier ? undefined : b.criteria} size={34} />
              <span>
                <span className="pb-badge-name">{b.name}</span>
                <span className="pb-badge-label">{b.label}</span>
                <span className="pb-badge-criteria">{b.criteria}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pb-missing">No badges earned yet.</p>
      )}
      <div className="pb-issue" data-testid="book-issue">
        <p className={`pb-status ${data.illustrative ? "pb-status-demo" : ""}`}>{i.status}</p>
        <dl className="pb-fields pb-fields-compact">
          <div><dt>Version</dt><dd>{i.version ?? "None (not issued)"}</dd></div>
          <div><dt>Issued</dt><dd>{i.issuedOn ?? "—"}</dd></div>
          {i.firstIssuedOn && <div><dt>First issued</dt><dd>{i.firstIssuedOn}</dd></div>}
          {i.verificationCode && <div><dt>Verification code</dt><dd className="pb-mono">{i.verificationCode}</dd></div>}
        </dl>
        <p className="pb-note">
          {i.note}{" "}
          {i.verifyHref && <a href={i.verifyHref} data-testid="book-verify-link">Open the verification page</a>}
        </p>
      </div>
    </Sheet>
  );
}

export function NotesPage({ data }: { data: BookData }) {
  return (
    <Sheet n={6} title="About this passport" ka="განმარტება" demo={data.demoLabel} reference={data.holder.reference}>
      <ul className="pb-notes">
        <li><b>Subject scores.</b> Every passport subject is worth 100 points split across quizzes, assignments, a project, a midterm and a final exam.</li>
        <li><b>Badges.</b> Silver from 60, Gold from 70, Platinum from 90 points. Below 60 a subject earns no badge.</li>
        <li><b>Skill stamps.</b> AI Skill, AI Applied Skill and AI Advanced Skill stamps come from BTU&apos;s confirmed skill records.</li>
        <li><b>Evidence.</b> Grade evidence comes from assessed coursework and exams; practical evidence from projects and applied activities.</li>
        <li><b>Versions.</b> New skills make a new version; the official document is the passport PDF.</li>
      </ul>
      {data.demoNote && <p className="pb-demo-note" data-testid="book-demo-note">{data.demoNote}</p>}
    </Sheet>
  );
}

export function BlankBack() {
  return <div className="pb-blank" aria-hidden="true" />;
}
