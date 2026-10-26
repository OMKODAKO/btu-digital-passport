/**
 * ILLUSTRATIVE DEMO DATA for the public booklet at /passport. Nothing here comes from the database.
 *
 * A fictional student with made-up marks in real catalog subjects (worker/subjects/catalog.json), scored with the
 * same rules as the backend: every component is worth its share of 100 points, so the score is the sum of the
 * marks, and the tiers are Silver 60, Gold 70, Platinum 90. Kept apart from real student data on purpose: no
 * passport ID, verification code or chain record, and every page of the booklet shows the demo label.
 */
import type { BookData, BookEvidence, BookSkill, BookSubject } from "@/lib/passport-book";
import { TIER_CRITERIA } from "@/lib/passport-book";
import type { Tier } from "@/lib/subjects";

type Mark = { kind: "QUIZ" | "ASSIGNMENT" | "PROJECT" | "MIDTERM" | "FINAL"; label: string; max: number; got?: number };
type DemoSubject = { code: string; en: string; ka: string; credits: number; area: string; marks: Mark[] };

const syllabus = (q?: number, a?: number, p?: number, m?: number, f?: number, project = "Project", tasks = "Assignments"): Mark[] => [
  { kind: "QUIZ", label: "Quizzes", max: 15, got: q },
  { kind: "ASSIGNMENT", label: tasks, max: 20, got: a },
  { kind: "PROJECT", label: project, max: 10, got: p },
  { kind: "MIDTERM", label: "Midterm exam", max: 25, got: m },
  { kind: "FINAL", label: "Final exam", max: 30, got: f },
];

const SUBJECTS: DemoSubject[] = [
  { code: "SUBJ-VIBE-CODING", en: "Vibe Coding and AI-Agentic Engineering", ka: "ვაიბ ქოუდინგი და AI-აგენტური ინჟინერია",
    credits: 3, area: "AI & ML", marks: syllabus(14, 19, 10, 22, 28, "Agent project") },
  { code: "SUBJ-AI-ML", en: "Artificial Intelligence and Machine Learning", ka: "ხელოვნური ინტელექტი და მანქანური სწავლება",
    credits: 6, area: "AI & ML", marks: syllabus(12, 17, 9, 19, 24, "Course project") },
  { code: "SUBJ-PYTHON", en: "Programming (Python)", ka: "პროგრამირება (Python)",
    credits: 6, area: "Programming", marks: syllabus(13, 18, 9, 21, 25, "Project", "Programming assignments") },
  { code: "SUBJ-DATABASES", en: "Introduction to Databases", ka: "მონაცემთა ბაზების საწყისები",
    credits: 6, area: "Data", marks: syllabus(10, 14, 7, 16, 19, "Project", "Labs") },
  { code: "SUBJ-DEEP-LEARNING", en: "Machine Learning (Deep Learning)", ka: "მანქანური სწავლება (ღრმა დასწავლა)",
    credits: 6, area: "AI & ML", marks: syllabus(13, 16, undefined, 20, undefined, "Course project") },
];

const tierFor = (score: number): Tier | null => (score >= 90 ? "PLATINUM" : score >= 70 ? "GOLD" : score >= 60 ? "SILVER" : null);
const TIER_NAME: Record<Tier, string> = { PLATINUM: "Platinum", GOLD: "Gold", SILVER: "Silver" };

function scored(s: DemoSubject) {
  const done = s.marks.every((m) => m.got !== undefined);
  const score = done ? s.marks.reduce((t, m) => t + (m.got ?? 0), 0) : null;
  return { ...s, done, score: score === null ? null : score.toFixed(2), tier: score === null ? null : tierFor(score) };
}
const scoredSubjects = SUBJECTS.map(scored);

const evidence = (s: (typeof scoredSubjects)[number]): BookEvidence[] =>
  s.marks.map((m) => ({
    kind: m.kind === "PROJECT" ? "practical" : "academic",
    title: `${s.en}: ${m.label}`,
    result: m.got === undefined ? "Not marked yet" : `${m.got} / ${m.max}`,
    source: `Illustrative demo record · ${s.code}`,
    explanation:
      m.kind === "PROJECT"
        ? `Practical project work: worth ${m.max} of the subject's 100 points.`
        : `Assessed ${m.kind.toLowerCase()}: worth ${m.max} of the subject's 100 points.`,
  }));

const skills: BookSkill[] = [
  ...scoredSubjects.map((s) => ({
    id: s.code,
    name: s.en,
    area: s.area,
    score: s.score,
    level: s.tier ? TIER_NAME[s.tier] : s.done ? "Below badge level" : "In progress",
    tier: s.tier,
    evidence: evidence(s),
  })),
  {
    id: "DEMO-HACKATHON",
    name: "AI Workflow Automation",
    area: "AI Applied Skill",
    score: null,
    level: "AI Applied Skill",
    tier: null,
    evidence: [
      {
        kind: "practical",
        title: "Two-day automation hackathon (fictional)",
        result: "Completed · team prototype",
        source: "Illustrative demo record · no real event",
        explanation: "Applied practice: the team automated a document workflow with an AI agent and presented it.",
      },
    ],
  },
];

const subjects: BookSubject[] = scoredSubjects.map((s) => ({
  code: s.code,
  nameEn: s.en,
  nameKa: s.ka,
  credits: String(s.credits),
  grade: s.score,
  status: s.done ? "Completed" : "In progress",
}));

const completed = scoredSubjects.filter((s) => s.done);
const ects = completed.reduce((t, s) => t + s.credits, 0);

export const DEMO_BOOK: BookData = {
  demoLabel: "Demo passport · fictional data",
  demoNote:
    "This is a demo booklet with a fictional student. It is not issued by BTU, it is not an official document and it is not registered on a blockchain.",
  illustrative: true,
  holder: {
    fullName: "Nika Demo-Beridze",
    program: "Computer Science",
    level: "Bachelor's",
    studyYear: "Year 3",
    reference: "DEMO-0000-AI",
  },
  journey: {
    summary: `${completed.length} technical subjects completed (${ects} ECTS), 1 in progress. Only subjects that count toward the AI passport are listed.`,
    subjects,
  },
  skills,
  badges: [
    ...scoredSubjects
      .filter((s) => s.tier)
      .map((s) => ({ name: s.en, tier: s.tier, label: `${TIER_NAME[s.tier!]} · ${s.score}`, criteria: TIER_CRITERIA[s.tier!] })),
    { name: "AI Workflow Automation", tier: null, label: "AI Applied Skill", criteria: "A 2–3 day applied activity, e.g. a hackathon" },
  ],
  issue: {
    status: "Demo passport",
    version: null,
    issuedOn: null,
    firstIssuedOn: null,
    verificationCode: null,
    verifyHref: null,
    note: "Not issued by BTU and not registered on any blockchain. Real passports are checked on the public verification page.",
  },
};
