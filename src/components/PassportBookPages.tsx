"use client";

import type { ReactNode } from "react";
import type { BookData, BookEvidence, BookSkill } from "@/lib/passport-book";
import type { Tier } from "@/lib/subjects";

/* The content of each face of the passport booklet. Pure rendering: navigation lives in PassportBook. */

export const SECTIONS = ["Identity", "Academic journey", "Skills", "Evidence", "Version record"];
export const TOTAL_PAGES = SECTIONS.length;
const pad = (n: number) => String(n).padStart(2, "0");

/** A rosette of rotated ellipses: the fine guilloche line work on the covers, the emblem and the seals. */
function Rosette({ r = 46, petals = 18, className }: { r?: number; petals?: number; className?: string }) {
  return (
    <g className={className} fill="none">
      {Array.from({ length: petals }, (_, i) => (
        <ellipse key={i} cx="0" cy="0" rx={r} ry={r * 0.38} transform={`rotate(${(180 / petals) * i})`} />
      ))}
    </g>
  );
}

/** The passport's own mark, not a university crest. */
function Emblem({ size = 112 }: { size?: number }) {
  return (
    <svg className="pb-emblem" width={size} height={size} viewBox="-60 -60 120 120" aria-hidden="true">
      <circle r="57" className="pb-emblem-ring" />
      <circle r="52" className="pb-emblem-ring pb-thin" />
      <Rosette r={46} petals={20} className="pb-emblem-lines" />
      <circle r="21" className="pb-emblem-core" />
      <text y="7" textAnchor="middle" className="pb-emblem-text">AI</text>
      <text y="-30" textAnchor="middle" className="pb-emblem-star">✱</text>
    </svg>
  );
}

const categoryClass = (s: string) => (/advanced/i.test(s) ? "advanced" : /applied/i.test(s) ? "applied" : "skill");

/** BTU's skill stamps (AI Skill, AI Applied Skill, AI Advanced Skill), one per category of confirmed skill. */
const STAMP: Record<string, { src: string; alt: string }> = {
  skill: { src: "/stamps/ai-skill.png", alt: "AI Skill stamp" },
  applied: { src: "/stamps/ai-applied-skill.png", alt: "AI Applied Skill stamp" },
  advanced: { src: "/stamps/ai-advanced-skill.png", alt: "AI Advanced Skill stamp" },
};

/** A hand-stamped look: each mark turned a few degrees, the same way every time for the same skill. */
const tiltFor = (id: string) => `${([...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 11) - 7}deg`;

/** The mark beside a skill: BTU's stamp for a confirmed skill, a tier seal for a scored subject. */
function Seal({ id, tier, category, size = 28 }: { id: string; tier: Tier | null; category: string | null; size?: number }) {
  if (!tier && category) {
    const stamp = STAMP[categoryClass(category)];
    return (
      <span className="pb-stamp" style={{ ["--s" as string]: `${size / 14}em`, ["--tilt" as string]: tiltFor(id) }}>
        <img src={stamp.src} alt={stamp.alt} loading="lazy" />
      </span>
    );
  }
  const tone = tier ? `tier-${tier.toLowerCase()}` : "none";
  return (
    <svg className={`pb-seal pb-seal-${tone}`} width={size} height={size} viewBox="-20 -20 40 40" aria-hidden="true">
      <circle r="18.5" />
      <Rosette r={14} petals={10} className="pb-seal-lines" />
      <text y="4.5" textAnchor="middle">{tier ? tier[0] : "✱"}</text>
    </svg>
  );
}

function Sheet({ n, ka, data, children }: { n: number; ka: string; data: BookData; children: ReactNode }) {
  return (
    <div className="pb-sheet" data-page={n}>
      <header className="pb-running">
        <span>Digital Skills Passport</span>
        <span className="pb-pageno" aria-label={`Page ${n} of ${TOTAL_PAGES}`}>{pad(n)}</span>
      </header>
      <h3 className="pb-title">
        {SECTIONS[n - 1]} <span lang="ka">{ka}</span>
      </h3>
      <div className="pb-body">{children}</div>
      <footer className="pb-foot">
        <span className="pb-mono">{data.holder.passportId} · V{data.issue.versionNo}</span>
        {data.demoLabel ? <span className="pb-demo-tag" data-testid="book-demo-label">{data.demoLabel}</span> : <span>{data.issue.issuedOn}</span>}
      </footer>
    </div>
  );
}

function Guilloche() {
  return (
    <svg className="pb-cover-guilloche" viewBox="-100 -72 200 284" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <Rosette r={118} petals={36} />
      <circle r="128" fill="none" />
      <circle r="131" fill="none" />
    </svg>
  );
}

export function CoverFace({ data, closed, onOpen }: { data: BookData; closed: boolean; onOpen: () => void }) {
  const inner = (
    <>
      <span className="pb-cover-top">AI Skills</span>
      <Emblem />
      <span className="pb-cover-title">
        Digital Skills <strong>Passport</strong>
      </span>
      <span className="pb-cover-sub" lang="ka">ციფრული უნარების პასპორტი</span>
      {(data.demoLabel || data.testIssuer) && (
        <span className="pb-cover-tags">
          {data.demoLabel && <span>{data.demoLabel}</span>}
          {data.testIssuer && <span>Test issuer</span>}
        </span>
      )}
      <span className="pb-cover-hint" aria-hidden={!closed}>Open passport</span>
    </>
  );
  return (
    <div className="pb-cover">
      <span className="pb-spine" aria-hidden="true" />
      <Guilloche />
      {closed ? (
        <button type="button" className="pb-cover-inner pb-cover-button" onClick={onOpen} data-testid="book-cover">
          <span className="pb-sr">Open the passport. </span>
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
      <span className="pb-spine" aria-hidden="true" />
      <Guilloche />
      <div className="pb-cover-inner">
        <Emblem size={84} />
        <span className="pb-back-name">Digital Skills Passport</span>
        <span className="pb-back-verify">
          {data.issue.registered ? (
            <>
              Verification code
              <br />
              <span className="pb-mono">{data.issue.verificationCode}</span>
            </>
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
  return (
    <Sheet n={1} ka="იდენტობა" data={data}>
      <div className="pb-identity">
        <div className="pb-portrait" aria-hidden="true">
          <svg viewBox="-50 -60 100 120"><Rosette r={44} petals={14} /></svg>
          <span>{initials}</span>
        </div>
        <dl className="pb-fields">
          <div>
            <dt>Holder</dt>
            <dd className="pb-name" data-testid="book-holder">{h.fullName}</dd>
          </div>
          <div>
            <dt>Academic programme</dt>
            <dd className={h.program ? undefined : "pb-missing"} data-testid="book-program">{h.program ?? "Not recorded"}</dd>
          </div>
          <div>
            <dt>Degree level</dt>
            <dd className={h.level ? undefined : "pb-missing"}>{h.level ?? "Not recorded"}</dd>
          </div>
        </dl>
      </div>
      <dl className="pb-fields pb-fields-row">
        <div>
          <dt>Passport ID</dt>
          <dd className="pb-mono" data-testid="book-passport-id">{h.passportId}</dd>
        </div>
        <div>
          <dt>First issued</dt>
          <dd>{h.firstIssued}</dd>
        </div>
      </dl>
      <p className="pb-mrz pb-mono" aria-hidden="true">
        {`P<AI<${h.passportId.replaceAll("-", "<")}<<V${data.issue.versionNo}`.padEnd(44, "<").slice(0, 44)}
      </p>
      <p className="pb-note">The Passport ID stays the same across versions. Email and student number are never printed.</p>
    </Sheet>
  );
}

export function JourneyPage({ data }: { data: BookData }) {
  const { courses, summary } = data.journey;
  return (
    <Sheet n={2} ka="აკადემიური გზა" data={data}>
      <p className="pb-lead">{summary}</p>
      {courses.length > 0 && (
        <table className="pb-table" data-testid="book-courses">
          <thead>
            <tr>
              <th scope="col">Subject</th>
              <th scope="col">Score</th>
              <th scope="col">ECTS</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.code}>
                <th scope="row">
                  {c.nameEn}
                  <span lang="ka">{c.nameKa}</span>
                </th>
                <td>
                  <span className="pb-mono">{c.score}</span>
                  <span className={`pb-tier pb-tier-${c.tier.toLowerCase()}`}>{c.tier.toLowerCase()}</span>
                </td>
                <td className="pb-mono">{c.credits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="pb-note">Scores are out of 100. Only completed passport subjects at badge level (60 and above) are certified.</p>
    </Sheet>
  );
}

export function SkillsPage({ data, selected, onSelect, single }: {
  data: BookData; selected: string | null; onSelect: (id: string) => void; single: boolean;
}) {
  const groups: [string, BookSkill[]][] = [
    ["Subject badges · calculated score", data.skills.filter((k) => k.group === "subject")],
    ["Confirmed skills · BTU skill records", data.skills.filter((k) => k.group === "skill")],
  ];
  return (
    <Sheet n={3} ka="უნარები" data={data}>
      <p className="pb-lead">Select a skill to see its evidence {single ? "on page 04" : "on the next page"}.</p>
      {groups.map(([title, items]) =>
        items.length ? (
          <section key={title} className="pb-skill-group" aria-label={title}>
            <h4 className="pb-h4">{title}</h4>
            <ul className="pb-skills" data-testid="book-skills">
              {items.map((k) => (
                <li key={k.id}>
                  <button type="button" className="pb-skill" aria-pressed={selected === k.id} onClick={() => onSelect(k.id)}
                    data-testid="book-skill">
                    <Seal id={k.id} tier={k.tier} category={k.category} size={k.tier ? 30 : 52} />
                    <span className="pb-skill-text">
                      <span className="pb-skill-name">{k.name}</span>
                      <span className="pb-skill-meta">{k.meta}</span>
                    </span>
                    {k.score ? (
                      <span className="pb-score" aria-label={`${k.level}, score ${k.score} of 100`}>
                        <span><span className="pb-mono">{k.score}</span> <span className="pb-level">{k.level}</span></span>
                        <span className="pb-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Number(k.score))}%` }} /></span>
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
      {!data.skills.length && <p className="pb-missing">No skills in this version.</p>}
    </Sheet>
  );
}

const EVIDENCE_GROUPS: [BookEvidence["kind"], string][] = [
  ["assessment", "Graded assessments"],
  ["project", "Project work"],
  ["record", "Skill record"],
];

/** The evidence for the skill chosen on the Skills page (the first one until another is chosen there). */
export function EvidencePage({ data, skill }: { data: BookData; skill: BookSkill | null }) {
  return (
    <Sheet n={4} ka="მტკიცებულება" data={data}>
      {skill && <p className="pb-lead">For the skill selected on page 03.</p>}
      {skill ? (
        <div className="pb-ev" aria-live="polite" data-testid="book-evidence" data-skill={skill.id}>
          <p className="pb-ev-head">
            <Seal id={skill.id} tier={skill.tier} category={skill.category} size={skill.tier ? 26 : 64} />
            <span>
              <strong>{skill.name}</strong> · {skill.level}
              {skill.score && <> · <span className="pb-mono">{skill.score}</span> / 100</>}
            </span>
          </p>
          {EVIDENCE_GROUPS.map(([kind, title]) => {
            const items = skill.evidence.filter((e) => e.kind === kind);
            return items.length ? (
              <section key={kind} className={`pb-ev-group pb-ev-${kind}`} aria-label={title}>
                <h4 className="pb-h4"><span className="pb-ev-mark" aria-hidden="true" />{title}</h4>
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
            ) : null;
          })}
          {skill.evidenceNote && <p className="pb-note">{skill.evidenceNote}</p>}
        </div>
      ) : (
        <p className="pb-missing">No skills to show evidence for.</p>
      )}
    </Sheet>
  );
}

export function RecordPage({ data }: { data: BookData }) {
  return (
    <Sheet n={5} ka="ვერსიები" data={data}>
      <ol className="pb-versions" data-testid="book-versions">
        {data.versions.map((v) => (
          <li key={v.versionNo} aria-current={v.selected ? "true" : undefined}>
            <span className="pb-v">V{v.versionNo}</span>
            <span>
              {v.issuedOn}
              <span className="pb-v-meta">
                {v.current ? "current" : "superseded"} · {v.registered ? "registered on a blockchain" : "not registered"}
              </span>
            </span>
            {v.selected ? <span className="pb-v-here">shown</span> : <a href={v.href}>View</a>}
          </li>
        ))}
      </ol>
      <ul className="pb-notes">
        <li>A new version is issued when new skills or subject badges are recorded. Earlier versions stay valid as history.</li>
        <li>Subject badges: Silver from 60, Gold from 70, Platinum from 90 of 100 points.</li>
        <li>The PDF of this version holds exactly the data shown in this booklet.</li>
      </ul>
    </Sheet>
  );
}

/** The plain inside of the back cover, opposite the last page. */
export function EndPaper() {
  return (
    <div className="pb-endpaper" aria-hidden="true">
      <svg viewBox="-60 -60 120 120"><Rosette r={50} petals={24} /></svg>
    </div>
  );
}

export function BlankBack() {
  return <div className="pb-blank" aria-hidden="true" />;
}
