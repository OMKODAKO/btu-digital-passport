import { getDb } from "./db";

/**
 * Read models for the admin area. Every function here is called only after a staff role check
 * (src/lib/auth/staff.ts). Nothing returns password hashes, session tokens, keys or raw sheet rows.
 */

export type DataSource = "BTU_TEST_DATA" | "SEED_SYNTHETIC";
export const SOURCE_LABEL: Record<string, string> = {
  BTU_TEST_DATA: "BTU hackathon test data",
  SEED_SYNTHETIC: "Synthetic demo data",
};

export function overview() {
  const db = getDb();
  const n = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  const sources = db.prepare("SELECT source, COUNT(*) AS n FROM students GROUP BY source").all() as { source: string; n: number }[];
  const lastRun = db
    .prepare("SELECT id FROM import_runs WHERE status = 'COMPLETED' ORDER BY id DESC LIMIT 1")
    .get() as { id: number } | undefined;
  return {
    sources,
    students: n("SELECT COUNT(*) AS n FROM students"),
    passports: n("SELECT COUNT(*) AS n FROM passports"),
    currentVersions: n("SELECT COUNT(*) AS n FROM passport_versions WHERE status = 'CURRENT'"),
    registeredCurrent: n("SELECT COUNT(*) AS n FROM passport_versions WHERE status = 'CURRENT' AND chain_tx_hash IS NOT NULL"),
    waiting: n("SELECT COUNT(*) AS n FROM version_candidates WHERE state = 'AWAITING_REGISTRATION'"),
    registrationErrors: n(
      "SELECT COUNT(*) AS n FROM version_candidates WHERE state = 'AWAITING_REGISTRATION' AND last_registration_error IS NOT NULL",
    ),
    needsGeneration: passportsNeedingGeneration().length,
    openRetries: n("SELECT COUNT(*) AS n FROM retry_requests WHERE state IN ('REQUESTED', 'RUNNING')"),
    lastRunId: lastRun?.id ?? null,
    lastRunIssues: lastRun
      ? (db
          .prepare("SELECT severity, COUNT(*) AS n FROM row_issues WHERE run_fk = ? AND code <> 'BADGE_FROM_FORMULA' GROUP BY severity")
          .all(lastRun.id) as { severity: string; n: number }[])
      : [],
    sourceStates: db.prepare("SELECT state, COUNT(*) AS n FROM source_records GROUP BY state").all() as { state: string; n: number }[],
    runs: db
      .prepare(
        `SELECT id, source_type AS sourceType, source_name AS sourceName, started_at AS startedAt,
                finished_at AS finishedAt, status, summary_json AS summary
           FROM import_runs ORDER BY id DESC LIMIT 10`,
      )
      .all() as { id: number; sourceType: string; sourceName: string; startedAt: string; finishedAt: string | null; status: string; summary: string | null }[],
    attention: attentionList(),
  };
}

/** Passports whose accepted skills are not all in their newest version (generation failed or never ran). */
function passportsNeedingGeneration(): number[] {
  return (
    getDb()
      .prepare(
        `SELECT DISTINCT p.id FROM passports p JOIN skill_awards a ON a.student_fk = p.student_fk
          WHERE a.record_id NOT IN (
            SELECT x.record_id FROM candidate_records x JOIN version_candidates c ON c.id = x.candidate_fk
             WHERE c.passport_fk = p.id AND c.state = 'AWAITING_REGISTRATION'
            UNION
            SELECT x.record_id FROM version_source_records x JOIN passport_versions v ON v.id = x.version_fk
             WHERE v.passport_fk = p.id AND v.status = 'CURRENT'
              AND NOT EXISTS (SELECT 1 FROM version_candidates c WHERE c.passport_fk = p.id AND c.state = 'AWAITING_REGISTRATION'))`,
      )
      .all() as { id: number }[]
  ).map((r) => r.id);
}

/** Passports that need staff attention: missing generation, or a waiting version (with or without an error). */
function attentionList() {
  const db = getDb();
  const gen = new Set(passportsNeedingGeneration());
  const rows = db
    .prepare(
      `SELECT p.id, p.passport_id AS passportId, s.student_id AS studentId,
              c.version_no AS waitingVersion, c.last_registration_error AS registrationError, c.registration_attempts AS attempts
         FROM passports p JOIN students s ON s.id = p.student_fk
         LEFT JOIN version_candidates c ON c.passport_fk = p.id AND c.state = 'AWAITING_REGISTRATION'
        ORDER BY p.passport_id`,
    )
    .all() as { id: number; passportId: string; studentId: string; waitingVersion: number | null; registrationError: string | null; attempts: number | null }[];
  return rows
    .filter((r) => gen.has(r.id) || r.waitingVersion !== null)
    .map((r) => ({ ...r, needsGeneration: gen.has(r.id) }));
}

export type SearchHit = { studentId: string; name: string; passportId: string | null; source: string; matchedBy: string };

/**
 * Finds students by an approved identifier only: Student ID, BTU email, Passport ID or a
 * verification code. Exact matches (case-insensitive), so the search can't be used to list people.
 */
export function searchStudents(raw: string): SearchHit[] {
  const q = raw.trim();
  if (q.length < 3 || q.length > 120) return [];
  const db = getDb();
  return db
    .prepare(
      `SELECT s.student_id AS studentId, s.first_name || ' ' || s.last_name AS name, p.passport_id AS passportId,
              s.source, m.matchedBy
         FROM (
           SELECT id AS sfk, 'Student ID' AS matchedBy FROM students WHERE student_id = ? COLLATE NOCASE
           UNION SELECT id, 'Email' FROM students WHERE email = ?
           UNION SELECT student_fk, 'Passport ID' FROM passports WHERE passport_id = ? COLLATE NOCASE
           UNION SELECT p.student_fk, 'Verification code' FROM passport_versions v JOIN passports p ON p.id = v.passport_fk
                  WHERE v.verification_code = ? COLLATE NOCASE
           UNION SELECT p.student_fk, 'Verification code (not issued)' FROM version_candidates c JOIN passports p ON p.id = c.passport_fk
                  WHERE c.verification_code = ? COLLATE NOCASE
           UNION SELECT id, 'Name' FROM students
                  WHERE first_name || ' ' || last_name LIKE @name ESCAPE '\\' OR last_name || ' ' || first_name LIKE @name ESCAPE '\\'
         ) m
         JOIN students s ON s.id = m.sfk
         LEFT JOIN passports p ON p.student_fk = s.id
        ORDER BY s.student_id LIMIT 50`,
    )
    // a name matches anywhere in "first last" or "last first", case-insensitive (ASCII); % and _ are literal
    .all(q, q, q, q, q, { name: `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%` }) as SearchHit[];
}

export function studentDetail(studentId: string) {
  const db = getDb();
  const student = db
    .prepare(
      `SELECT id, student_id AS studentId, first_name AS firstName, last_name AS lastName, email, program,
              education_level AS educationLevel, student_status AS status, source, created_at AS createdAt
         FROM students WHERE student_id = ?`,
    )
    .get(studentId) as
    | { id: number; studentId: string; firstName: string; lastName: string; email: string; program: string | null;
        educationLevel: string | null; status: string | null; source: string; createdAt: string }
    | undefined;
  if (!student) return null;

  const passport = db
    .prepare("SELECT id, passport_id AS passportId, first_issued_on AS firstIssuedOn FROM passports WHERE student_fk = ?")
    .get(student.id) as { id: number; passportId: string; firstIssuedOn: string } | undefined;
  const pid = passport?.id ?? -1;

  const versions = db
    .prepare(
      `SELECT id, version_no AS versionNo, verification_code AS verificationCode, status, issued_at AS issuedAt,
              activated_at AS activatedAt, pdf_sha256 AS pdfSha256, chain_tx_hash AS txHash, chain_network AS network,
              chain_id AS chainId, chain_block_number AS blockNumber, chain_confirmations AS confirmations, chain_issuer AS issuer,
              chain_issuer_label AS issuerLabel, chain_issuer_test_only AS issuerTestOnly,
              chain_registered_at AS registeredAt,
              (SELECT COUNT(*) FROM version_source_records x WHERE x.version_fk = passport_versions.id) AS records
         FROM passport_versions WHERE passport_fk = ? ORDER BY version_no DESC`,
    )
    .all(pid) as {
      id: number; versionNo: number; verificationCode: string; status: string; issuedAt: string; activatedAt: string | null;
      pdfSha256: string; txHash: string | null; network: string | null; chainId: number | null; blockNumber: number | null;
      confirmations: number | null; issuer: string | null; issuerLabel: string | null; issuerTestOnly: number | null;
      registeredAt: string | null; records: number;
    }[];

  const candidates = db
    .prepare(
      `SELECT version_no AS versionNo, state, generated_at AS generatedAt, registration_attempts AS attempts,
              last_registration_error AS lastError, chain_tx_submitted AS txSubmitted, void_reason AS voidReason
         FROM version_candidates WHERE passport_fk = ? AND state <> 'ISSUED' ORDER BY version_no DESC`,
    )
    .all(pid) as { versionNo: number; state: string; generatedAt: string; attempts: number; lastError: string | null; txSubmitted: string | null; voidReason: string | null }[];

  // every source row for this student, with the problems found the last time it was read
  const records = db
    .prepare(
      `SELECT r.record_id AS recordId, r.sheet_row AS sheetRow, r.state, r.last_seen_run AS lastRun,
              json_extract(r.raw_json, '$."Skill Name"') AS skillName,
              a.date_earned AS dateEarned, a.accepted_at AS acceptedAt,
              q.sync_status AS syncStatus, q.synced_version AS syncedVersion, q.notes AS syncNotes,
              (SELECT json_group_array(i.severity || ' ' || i.code || ': ' || i.message) FROM row_issues i
                WHERE i.run_fk = r.last_seen_run AND i.record_id = r.record_id AND i.code <> 'BADGE_FROM_FORMULA') AS issues
         FROM source_records r
         LEFT JOIN skill_awards a ON a.record_id = r.record_id
         LEFT JOIN sheet_status q ON q.record_id = r.record_id
        WHERE r.student_code = ? ORDER BY r.record_id`,
    )
    .all(student.studentId) as {
      recordId: string; sheetRow: number; state: string; lastRun: number; skillName: string | null;
      dateEarned: string | null; acceptedAt: string | null; syncStatus: string | null; syncedVersion: string | null;
      syncNotes: string | null; issues: string;
    }[];

  const failures = db
    .prepare("SELECT run_fk AS runId, record_ids_json AS records, error, created_at AS at FROM generation_failures WHERE passport_fk = ? ORDER BY id DESC LIMIT 20")
    .all(pid) as { runId: number; records: string; error: string; at: string }[];
  const retries = db
    .prepare(
      `SELECT r.id, r.requested_at AS requestedAt, s.email AS requestedBy, r.reason, r.state, r.finished_at AS finishedAt,
              r.result_json AS result
         FROM retry_requests r JOIN staff s ON s.id = r.requested_by WHERE r.passport_fk = ? ORDER BY r.id DESC LIMIT 20`,
    )
    .all(pid) as { id: number; requestedAt: string; requestedBy: string; reason: string; state: string; finishedAt: string | null; result: string | null }[];

  return {
    student, passport: passport ?? null, versions, candidates, records, failures, retries,
    audit: passport ? auditLog({ passportFk: passport.id, limit: 50 }) : [],
    retry: passport ? retryEligibility(passport.id) : { eligible: false, reasons: ["No passport yet."], open: false },
  };
}

/** Whether a retry would do anything for this passport, decided on the server from the database. */
export function retryEligibility(passportFk: number): { eligible: boolean; reasons: string[]; open: boolean } {
  const db = getDb();
  const reasons: string[] = [];
  if (passportsNeedingGeneration().includes(passportFk))
    reasons.push("Accepted skills are missing from the newest version (generation failed or hasn't run).");
  const waiting = db
    .prepare("SELECT version_no, last_registration_error FROM version_candidates WHERE passport_fk = ? AND state = 'AWAITING_REGISTRATION'")
    .get(passportFk) as { version_no: number; last_registration_error: string | null } | undefined;
  if (waiting)
    reasons.push(
      waiting.last_registration_error
        ? `V${waiting.version_no} failed blockchain registration.`
        : `V${waiting.version_no} is waiting for blockchain registration.`,
    );
  const open = !!db.prepare("SELECT 1 FROM retry_requests WHERE passport_fk = ? AND state IN ('REQUESTED', 'RUNNING')").get(passportFk);
  return { eligible: reasons.length > 0 && !open, reasons, open };
}

export function passportFkById(passportId: string): number | null {
  const row = getDb().prepare("SELECT id FROM passports WHERE passport_id = ?").get(passportId) as { id: number } | undefined;
  return row?.id ?? null;
}

export type IssueRow = { sheetRow: number | null; recordId: string | null; studentCode: string | null; severity: string; code: string; message: string };

/** Problems found by the most recent completed import, grouped for the issues page. */
export function latestIssues() {
  const db = getDb();
  const run = db
    .prepare("SELECT id, source_name AS sourceName, finished_at AS finishedAt FROM import_runs WHERE status = 'COMPLETED' ORDER BY id DESC LIMIT 1")
    .get() as { id: number; sourceName: string; finishedAt: string } | undefined;
  if (!run) return null;
  const all = db
    .prepare(
      `SELECT sheet_row AS sheetRow, record_id AS recordId, student_code AS studentCode, severity, code, message
         FROM row_issues WHERE run_fk = ? AND code <> 'BADGE_FROM_FORMULA' ORDER BY sheet_row, id`,
    )
    .all(run.id) as IssueRow[];
  const by = (codes: string[]) => all.filter((i) => codes.includes(i.code));
  return {
    run,
    invalidStudentIds: by(["INVALID_STUDENT_ID", "IDENTITY_CONFLICT", "EMAIL_CONFLICT", "DATABASE_CONFLICT", "PASSPORT_ID_CONFLICT", "INVALID_PASSPORT_ID"]),
    duplicates: by(["DUPLICATE_RECORD_ID", "DUPLICATE_SKILL", "RECORD_OWNER_CHANGED"]),
    errors: all.filter((i) => i.severity === "ERROR"),
    holds: all.filter((i) => i.severity === "HOLD"),
    warnings: all.filter((i) => i.severity === "WARNING"),
  };
}

export type AuditEntry = { id: number; at: string; actorKind: string; actorRef: string | null; action: string; passportId: string | null; details: string | null };

export function auditLog({ passportFk, action, limit = 200 }: { passportFk?: number; action?: string; limit?: number } = {}): AuditEntry[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (passportFk !== undefined) (where.push("a.passport_fk = ?"), args.push(passportFk));
  if (action) (where.push("a.action = ?"), args.push(action));
  return getDb()
    .prepare(
      `SELECT a.id, a.at, a.actor_kind AS actorKind, a.actor_ref AS actorRef, a.action, p.passport_id AS passportId, a.details
         FROM audit_log a LEFT JOIN passports p ON p.id = a.passport_fk
        ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY a.id DESC LIMIT ?`,
    )
    .all(...args, Math.min(Math.max(limit, 1), 1000)) as AuditEntry[];
}

export function auditActions(): string[] {
  return (getDb().prepare("SELECT DISTINCT action FROM audit_log ORDER BY action").all() as { action: string }[]).map((r) => r.action);
}
