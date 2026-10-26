/**
 * The data the interactive passport booklet (src/components/PassportBook.tsx) shows, as one plain structure.
 *
 * `bookForStudent` fills it from a signed-in student's own records: their passport version, the sheet skills in
 * that version, their subject results (passport-relevant subjects only, the same filter as the admin area) and the
 * subject badges the version certifies. Nothing here is invented: a value the records don't have stays null and the
 * booklet says "not recorded". The public demo booklet uses the separate fixture in src/demo/passport-book-demo.ts.
 */
import { getDb } from "./db";
import type { Passport, PassportVersion, VersionSkill } from "./passports";
import { ectsLabel, isSheetSkill, studentResults, TIER_LABEL, type SubjectResult, type Tier } from "./subjects";

export type BookEvidence = {
  kind: "academic" | "practical";
  title: string; // the course, assessment or activity
  result: string; // "22 / 25", "Completed"
  source: string; // where the record comes from
  explanation: string; // how it contributes to the skill
};
export type BookSkill = {
  id: string;
  name: string;
  area: string;
  score: string | null; // only when the backend calculated one ("84.50" of 100)
  level: string; // "Gold", "AI Applied Skill", "In progress"
  tier: Tier | null;
  evidence: BookEvidence[];
};
export type BookSubject = { code: string; nameEn: string; nameKa: string; credits: string; grade: string | null; status: string };
export type BookBadge = { name: string; tier: Tier | null; label: string; criteria: string };
export type BookData = {
  /** null for a real record; otherwise the label printed on the cover and every page ("Demo passport"). */
  demoLabel: string | null;
  /** what kind of record this is, said in full on the notes page (null for a real record) */
  demoNote: string | null;
  /** true only for the fictional fixture: its evidence has no record behind it */
  illustrative: boolean;
  holder: { fullName: string; program: string | null; level: string | null; studyYear: string | null; reference: string };
  journey: { summary: string; subjects: BookSubject[] };
  skills: BookSkill[];
  badges: BookBadge[];
  issue: {
    status: string; // "Demo passport", "Current version", "Superseded version"
    version: string | null; // "V3"
    issuedOn: string | null; // "26 Oct 2026"
    firstIssuedOn: string | null;
    verificationCode: string | null; // only for versions registered on a blockchain
    verifyHref: string | null; // the real public verification page, only when there is a record to check
    note: string;
  };
};

export const TIER_CRITERIA: Record<Tier, string> = {
  SILVER: "Subject score 60–69.99 of 100",
  GOLD: "Subject score 70–89.99 of 100",
  PLATINUM: "Subject score 90–100 of 100",
};

const ACADEMIC_KINDS = new Set(["QUIZ", "ASSIGNMENT", "MIDTERM", "FINAL"]);
const SHEET_PRACTICAL = /applied/i; // sheet categories: AI Skill, AI Applied Skill, AI Advanced Skill

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : null;
const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Evidence for a subject: one line per syllabus component, marked or not. */
function subjectEvidence(r: SubjectResult): BookEvidence[] {
  const name = r.subject.nameEn;
  const simulated = r.subject.simulated ? " (simulated syllabus)" : "";
  return r.subject.components.map((c) => {
    const mark = r.marks[c.label];
    return {
      kind: ACADEMIC_KINDS.has(c.kind) ? "academic" : "practical",
      title: `${name}: ${c.label}`,
      result: mark === undefined ? "Not marked yet" : `${pts(mark)} / ${pts(c.maxPoints)}`,
      source: `BTU grade record · ${r.subject.code} · syllabus v${r.syllabusVersion}${simulated}`,
      explanation:
        c.kind === "PROJECT"
          ? `Practical project work: worth ${pts(c.weight)} of the subject's 100 points.`
          : `Assessed ${c.kind.toLowerCase()}: worth ${pts(c.weight)} of the subject's 100 points.`,
    };
  });
}

function subjectSkill(r: SubjectResult): BookSkill {
  return {
    id: r.subject.code,
    name: r.subject.nameEn,
    area: r.subject.skillArea ?? (isSheetSkill(r.subject.code) ? "AI skill course" : "Subject"),
    score: r.score,
    level: r.tier ? TIER_LABEL[r.tier] : r.status === "COMPLETE" ? "Below badge level" : "In progress",
    tier: r.tier,
    evidence: subjectEvidence(r),
  };
}

function sheetSkill(k: VersionSkill): BookSkill {
  const practical = SHEET_PRACTICAL.test(k.category);
  return {
    id: k.recordId,
    name: k.name,
    area: k.category,
    score: null, // the skill sheet records a confirmed skill, not a score
    level: k.category,
    tier: null,
    evidence: [
      {
        kind: practical ? "practical" : "academic",
        title: k.name,
        result: `Confirmed by BTU · ${fmtDate(k.dateEarned)}`,
        source: `BTU skill record ${k.recordId} · badge ${k.badgeCode}`,
        explanation: k.description || "BTU confirmed this skill in its skill records.",
      },
    ],
  };
}

/** Subject badges a passport version certifies (migration 008); empty before that migration. */
function versionSubjectBadges(versionNo: number, passportId: string): { code: string; score: string; tier: Tier }[] {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'version_subjects'").get()) return [];
  return db
    .prepare(
      `SELECT s.subject_code AS code, s.score, s.tier FROM version_subjects s
         JOIN passport_versions v ON v.id = s.version_fk JOIN passports p ON p.id = v.passport_fk
        WHERE p.passport_id = ? AND v.version_no = ? ORDER BY s.subject_code`,
    )
    .all(passportId, versionNo) as { code: string; score: string; tier: Tier }[];
}

export function bookForStudent(input: {
  student: { id: number; firstName: string; lastName: string; program: string | null; educationLevel: string | null; source: string };
  passport: Passport;
  version: PassportVersion;
  sheetSkills: VersionSkill[];
}): BookData {
  const { student, passport, version, sheetSkills } = input;
  const results = studentResults(student.id);
  const complete = results.filter((r) => r.status === "COMPLETE");
  const badged = complete.filter((r) => r.tier);
  const certified = versionSubjectBadges(version.versionNo, passport.passportId);
  const subjectName = new Map(results.map((r) => [r.subject.code, r.subject.nameEn]));

  const summary = results.length
    ? `${results.length} passport subject${results.length === 1 ? "" : "s"} on record: ${complete.length} completed, ` +
      `${results.length - complete.length} in progress, ${badged.length} at badge level.`
    : "No passport subject marks are on record yet. Skills below come from BTU's skill records.";

  const demoLabel =
    student.source === "BTU_TEST_DATA" ? "BTU test data" : student.source === "SEED_SYNTHETIC" ? "Demo data" : null;

  return {
    demoLabel,
    demoNote: demoLabel
      ? "This booklet is built from BTU's hackathon test data, not from a real student record. Its versions are registered on a test blockchain by a test issuer."
      : null,
    illustrative: false,
    holder: {
      fullName: `${student.firstName} ${student.lastName}`,
      program: student.program,
      level: student.educationLevel,
      studyYear: null, // the student record has no study year
      reference: passport.passportId,
    },
    journey: {
      summary,
      subjects: results.map((r) => ({
        code: r.subject.code,
        nameEn: r.subject.nameEn,
        nameKa: r.subject.nameKa,
        credits: ectsLabel(r.subject.code, r.subject.credits),
        grade: r.score,
        status: r.status === "COMPLETE" ? "Completed" : "In progress",
      })),
    },
    skills: [...results.map(subjectSkill), ...sheetSkills.map(sheetSkill)],
    badges: [
      ...certified.map((b) => ({
        name: subjectName.get(b.code) ?? b.code,
        tier: b.tier,
        label: `${TIER_LABEL[b.tier]} · ${b.score}`,
        criteria: TIER_CRITERIA[b.tier],
      })),
      ...sheetSkills.map((k) => ({
        name: k.name,
        tier: null,
        label: k.badgeCode,
        criteria: `${k.category}, confirmed in BTU's skill records`,
      })),
    ],
    issue: {
      status: version.status === "CURRENT" ? "Current version" : "Superseded version",
      version: `V${version.versionNo}`,
      issuedOn: fmtDate(version.issuedAt),
      firstIssuedOn: fmtDate(passport.firstIssuedOn),
      verificationCode: version.chainTxHash ? version.verificationCode : null,
      verifyHref: version.chainTxHash ? `/verify/${version.verificationCode}` : null,
      note: version.chainTxHash
        ? version.chainIssuerTestOnly !== 0
          ? "Registered on a test blockchain by a test issuer: official BTU issuer verification is still pending."
          : "Registered on a blockchain. Anyone can check this version on the public verification page."
        : "This version is not registered on a blockchain, so it cannot be publicly verified.",
    },
  };
}
