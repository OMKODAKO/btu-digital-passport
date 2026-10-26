import { getDb } from "./db";

/**
 * Subject catalog, simulated syllabi, marks and subject results for the admin area (migrations 006, 007).
 *
 * The rules match the worker's (worker/subjects): marks only for passport subjects, each mark within
 * 0..max with at most two decimals, a student stays on the syllabus version of their first mark, marks
 * are append-only (a different mark is a correction row), and the same mark again changes nothing.
 * Score = Σ weight × earned / max, rounded half up to 2 decimals; tiers 60 Silver, 70 Gold, 90 Platinum.
 * Current syllabi give each component its weight as maximum, so the score is simply the sum of the marks.
 * The arithmetic is exact (BigInt fractions) so the web and the worker always agree.
 */

export type Component = { id: number; position: number; kind: string; label: string; weight: number; maxPoints: number };
export type Subject = {
  id: number; code: string; nameKa: string; nameEn: string; credits: number; passportRelevant: boolean;
  skillArea: string | null; syllabusVersion: number | null; simulated: boolean; components: Component[];
};
export type Tier = "PLATINUM" | "GOLD" | "SILVER";
export type SubjectResult = {
  subject: Subject; syllabusVersion: number; marks: Record<string, number>; missing: string[];
  status: "COMPLETE" | "IN_PROGRESS"; score: string | null; tier: Tier | null;
};

export const TIER_LABEL: Record<Tier, string> = { PLATINUM: "Platinum", GOLD: "Gold", SILVER: "Silver" };
const TIERS: [Tier, number][] = [["PLATINUM", 9000], ["GOLD", 7000], ["SILVER", 6000]]; // in hundredths of a point

export class MarkError extends Error {}

function components(syllabusFk: number): Component[] {
  return getDb()
    .prepare(
      `SELECT id, position, kind, label, weight, max_points AS maxPoints FROM syllabus_components
        WHERE syllabus_fk = ? ORDER BY position`,
    )
    .all(syllabusFk) as Component[];
}

type SubjectRow = { id: number; code: string; nameKa: string; nameEn: string; credits: number; relevant: number; skillArea: string | null };
const SUBJECT_COLS = `id, code, name_ka AS nameKa, name_en AS nameEn, credits, passport_relevant AS relevant, skill_area AS skillArea`;

function withSyllabus(row: SubjectRow, syllabus?: { id: number; version: number; simulated: number }): Subject {
  const y =
    syllabus ??
    (getDb()
      .prepare("SELECT id, version, simulated FROM syllabi WHERE subject_fk = ? ORDER BY version DESC LIMIT 1")
      .get(row.id) as { id: number; version: number; simulated: number } | undefined);
  return {
    id: row.id, code: row.code, nameKa: row.nameKa, nameEn: row.nameEn, credits: row.credits,
    passportRelevant: row.relevant === 1, skillArea: row.skillArea,
    syllabusVersion: y?.version ?? null, simulated: y ? y.simulated === 1 : true, components: y ? components(y.id) : [],
  };
}

export function listSubjects(all = false): Subject[] {
  const rows = getDb()
    .prepare(`SELECT ${SUBJECT_COLS} FROM subjects ${all ? "" : "WHERE passport_relevant = 1"}
               ORDER BY passport_relevant DESC, skill_area, name_en`)
    .all() as SubjectRow[];
  return rows.map((r) => withSyllabus(r));
}

export function getSubject(code: string): Subject | null {
  const row = getDb().prepare(`SELECT ${SUBJECT_COLS} FROM subjects WHERE code = ?`).get(code) as SubjectRow | undefined;
  return row ? withSyllabus(row) : null;
}

/** The syllabus a student is marked under in a subject: that of their first mark, else the newest. */
function studentSyllabus(studentFk: number, subjectFk: number) {
  const db = getDb();
  return (db
    .prepare(
      `SELECT y.id, y.version, y.simulated FROM grade_entries g JOIN syllabus_components c ON c.id = g.component_fk
         JOIN syllabi y ON y.id = c.syllabus_fk WHERE g.student_fk = ? AND y.subject_fk = ? ORDER BY g.id LIMIT 1`,
    )
    .get(studentFk, subjectFk) ??
    db.prepare("SELECT id, version, simulated FROM syllabi WHERE subject_fk = ? ORDER BY version DESC LIMIT 1").get(subjectFk)) as
    | { id: number; version: number; simulated: number }
    | undefined;
}

type Entry = { id: number; componentFk: number; points: number };
function latestEntries(studentFk: number, syllabusFk: number): Map<number, Entry> {
  const rows = getDb()
    .prepare(
      `SELECT g.id, g.component_fk AS componentFk, g.points FROM grade_entries g
         JOIN syllabus_components c ON c.id = g.component_fk
        WHERE g.student_fk = ? AND c.syllabus_fk = ?
          AND NOT EXISTS (SELECT 1 FROM grade_entries n WHERE n.supersedes_fk = g.id)`,
    )
    .all(studentFk, syllabusFk) as Entry[];
  return new Map(rows.map((r) => [r.componentFk, r]));
}

/** A number with at most two decimals as an exact count of hundredths. */
function hundredths(n: number): bigint {
  const h = Math.round(n * 100);
  if (Math.abs(n * 100 - h) > 1e-6) throw new MarkError(`${n} has more than two decimals`);
  return BigInt(h);
}

/** Σ weight × earned / max, rounded half up to 2 decimals, as a "77.00"-style string. */
export function subjectScore(comps: Component[], marks: Record<string, number>): string {
  // value = Σ (W/100)(P/100)/(M/100) = Σ W·P / (M·100), summed as one exact fraction num/den
  let num = 0n;
  let den = 1n;
  for (const c of comps) {
    if (marks[c.label] === undefined) throw new MarkError(`no mark for ${c.label}`);
    const n = hundredths(c.weight) * hundredths(marks[c.label]);
    const d = hundredths(c.maxPoints) * 100n;
    num = num * d + n * den;
    den = den * d;
  }
  const h = (2n * num * 100n + den) / (2n * den); // hundredths, half up (the value is never negative)
  return `${h / 100n}.${String(h % 100n).padStart(2, "0")}`;
}

export function tierFor(score: string): Tier | null {
  const h = hundredths(Number(score));
  return TIERS.find(([, low]) => h >= BigInt(low))?.[0] ?? null;
}

export function studentResults(studentFk: number): SubjectResult[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT s.id, s.code, s.name_ka AS nameKa, s.name_en AS nameEn, s.credits, s.passport_relevant AS relevant,
              s.skill_area AS skillArea
         FROM grade_entries g JOIN syllabus_components c ON c.id = g.component_fk
         JOIN syllabi y ON y.id = c.syllabus_fk JOIN subjects s ON s.id = y.subject_fk
        WHERE g.student_fk = ? AND s.passport_relevant = 1 ORDER BY s.skill_area, s.name_en`,
    )
    .all(studentFk) as SubjectRow[];
  return rows.map((row) => {
    const y = studentSyllabus(studentFk, row.id)!;
    const subject = withSyllabus(row, y);
    const latest = latestEntries(studentFk, y.id);
    const marks: Record<string, number> = {};
    const missing: string[] = [];
    for (const c of subject.components) {
      const e = latest.get(c.id);
      if (e) marks[c.label] = e.points;
      else missing.push(c.label);
    }
    const score = missing.length ? null : subjectScore(subject.components, marks);
    return { subject, syllabusVersion: y.version, marks, missing, status: missing.length ? "IN_PROGRESS" : "COMPLETE",
             score, tier: score ? tierFor(score) : null };
  });
}

/** The subject as one student is (or will be) marked under it, with their latest marks. */
export function markSheet(studentFk: number, code: string) {
  const row = getDb().prepare(`SELECT ${SUBJECT_COLS} FROM subjects WHERE code = ?`).get(code) as SubjectRow | undefined;
  if (!row) return null;
  const y = studentSyllabus(studentFk, row.id);
  const subject = withSyllabus(row, y);
  const latest = y ? latestEntries(studentFk, y.id) : new Map<number, Entry>();
  return { subject, marks: Object.fromEntries(subject.components.filter((c) => latest.has(c.id)).map((c) => [c.label, latest.get(c.id)!.points])) };
}

/**
 * Records marks (component label -> points). Everything is checked before anything is written; a mark equal
 * to the latest one is skipped, a different one is stored as a correction of it.
 */
export function recordMarks(studentFk: number, code: string, marks: Record<string, number>, enteredBy: string, note: string | null) {
  const db = getDb();
  const sheet = markSheet(studentFk, code);
  if (!sheet) throw new MarkError(`No subject ${code}.`);
  const { subject } = sheet;
  if (!subject.passportRelevant) throw new MarkError(`${subject.nameEn} does not count toward the passport.`);
  if (!subject.components.length) throw new MarkError(`${subject.nameEn} has no syllabus.`);
  if (!Object.keys(marks).length) throw new MarkError("Enter at least one mark.");
  const byLabel = new Map(subject.components.map((c) => [c.label, c]));
  for (const [label, points] of Object.entries(marks)) {
    const c = byLabel.get(label);
    if (!c) throw new MarkError(`${label} is not in this syllabus.`);
    if (!Number.isFinite(points) || points < 0 || points > c.maxPoints) {
      throw new MarkError(`${label}: ${points} is outside 0–${c.maxPoints}.`);
    }
    hundredths(points);
  }
  const added: string[] = [];
  const corrected: string[] = [];
  const unchanged: string[] = [];
  db.transaction(() => {
    const y = studentSyllabus(studentFk, subject.id)!;
    const latest = latestEntries(studentFk, y.id);
    const now = new Date().toISOString().slice(0, 19) + "Z";
    const insert = db.prepare(
      `INSERT INTO grade_entries (student_fk, component_fk, points, source, entered_by, entered_at, supersedes_fk, note)
       VALUES (?, ?, ?, 'MANUAL', ?, ?, ?, ?)`,
    );
    for (const c of subject.components) {
      if (!(c.label in marks)) continue;
      const prev = latest.get(c.id);
      if (prev && prev.points === marks[c.label]) {
        unchanged.push(c.label);
        continue;
      }
      insert.run(studentFk, c.id, marks[c.label], enteredBy, now, prev?.id ?? null, note);
      (prev ? corrected : added).push(c.label);
    }
  })();
  return { subject, added, corrected, unchanged };
}

/** A skill from the skill sheet offered as a course (catalog code = its Skill ID). The sheet gives it no ECTS. */
export const isSheetSkill = (code: string) => /^SKL-\d{3}$/.test(code);
/** ECTS as shown: a sheet skill's stored credits are only a placeholder. */
export const ectsLabel = (code: string, credits: number) => (isSheetSkill(code) ? "—" : String(credits));

export const KINDS = ["QUIZ", "ASSIGNMENT", "PROJECT", "MIDTERM", "FINAL"] as const;
export type CourseRow = {
  studentId: string; firstName: string; lastName: string; email: string; program: string | null;
  educationLevel: string | null; status: string | null; subjectCode: string; subjectEn: string; subjectKa: string;
  credits: number; syllabusVersion: number; points: Partial<Record<(typeof KINDS)[number], number | null>>;
  total: string | null; tier: Tier | null; resultStatus: "COMPLETE" | "IN_PROGRESS";
};

/** One line per student per course they have marks in: the student's columns, the course, the latest
 *  points per component kind (null = not marked yet; absent = not in that syllabus), total and badge. */
export function courseRows(): CourseRow[] {
  const students = getDb()
    .prepare(
      `SELECT id, student_id AS studentId, first_name AS firstName, last_name AS lastName, email, program,
              education_level AS educationLevel, student_status AS status
         FROM students WHERE id IN (SELECT student_fk FROM grade_entries) ORDER BY student_id`,
    )
    .all() as ({ id: number } & Omit<CourseRow, "subjectCode">)[];
  return students.flatMap(({ id, ...s }) =>
    studentResults(id).map((r) => {
      const points: CourseRow["points"] = {};
      for (const c of r.subject.components) {
        const kind = c.kind as (typeof KINDS)[number];
        points[kind] = (points[kind] ?? 0) + (r.marks[c.label] ?? NaN);
      }
      for (const k of Object.keys(points) as (typeof KINDS)[number][]) if (Number.isNaN(points[k])) points[k] = null;
      return {
        studentId: s.studentId, firstName: s.firstName, lastName: s.lastName, email: s.email, program: s.program,
        educationLevel: s.educationLevel, status: s.status, subjectCode: r.subject.code, subjectEn: r.subject.nameEn,
        subjectKa: r.subject.nameKa, credits: r.subject.credits, syllabusVersion: r.syllabusVersion, points,
        total: r.score, tier: r.tier, resultStatus: r.status,
      };
    }),
  );
}
