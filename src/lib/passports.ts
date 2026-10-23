import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STORAGE_DIR } from "./config";
import { getDb } from "./db";

export type PassportVersion = {
  versionNo: number;
  verificationCode: string;
  status: "CURRENT" | "SUPERSEDED";
  issuedAt: string;
  pdfStorageKey: string;
  pdfSha256: string;
  chainTxHash: string | null;
  chainNetwork: string | null;
  chainId: number | null;
  chainBlockNumber: number | null;
  chainIssuerLabel: string | null;
  chainIssuerTestOnly: number | null;
};

export type Passport = {
  passportId: string;
  holderFirstName: string;
  holderLastName: string;
  firstIssuedOn: string;
  versions: PassportVersion[]; // newest first
  current: PassportVersion | null;
};

/**
 * The passport that belongs to this student (by internal id), or null if none exists yet.
 * Only issued versions (passport_versions) are listed; versions waiting for registration live in
 * version_candidates and are never offered for viewing or download.
 */
export function getPassportForStudent(studentFk: number): Passport | null {
  const db = getDb();
  const p = db
    .prepare(
      `SELECT id, passport_id AS passportId, holder_first_name AS holderFirstName,
              holder_last_name AS holderLastName, first_issued_on AS firstIssuedOn
         FROM passports WHERE student_fk = ?`,
    )
    .get(studentFk) as (Omit<Passport, "versions" | "current"> & { id: number }) | undefined;
  if (!p) return null;

  const versions = db
    .prepare(
      `SELECT version_no AS versionNo, verification_code AS verificationCode, status,
              issued_at AS issuedAt, pdf_storage_key AS pdfStorageKey,
              pdf_sha256 AS pdfSha256, chain_tx_hash AS chainTxHash, chain_network AS chainNetwork,
              chain_id AS chainId, chain_block_number AS chainBlockNumber, chain_issuer_label AS chainIssuerLabel,
              chain_issuer_test_only AS chainIssuerTestOnly
         FROM passport_versions WHERE passport_fk = ? ORDER BY version_no DESC`,
    )
    .all(p.id) as PassportVersion[];

  const { id: _id, ...rest } = p;
  return { ...rest, versions, current: versions.find((v) => v.status === "CURRENT") ?? null };
}

export type PdfResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: "missing" | "integrity" };

/**
 * Reads a stored PDF and checks it against the hash recorded at issue time.
 * A file that is gone or no longer matches is never served.
 */
export function readVersionPdf(version: PassportVersion): PdfResult {
  const root = path.resolve(STORAGE_DIR);
  const file = path.resolve(root, version.pdfStorageKey);
  if (!file.startsWith(root + path.sep)) return { ok: false, reason: "missing" };
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    return { ok: false, reason: "missing" };
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  return hash === version.pdfSha256 ? { ok: true, bytes } : { ok: false, reason: "integrity" };
}

export type VersionSkill = {
  recordId: string;
  name: string;
  category: string;
  badgeCode: string;
  description: string;
  dateEarned: string;
};

/** Skills contained in one version of this student's own passport (empty for versions made before stage 2). */
export function getVersionSkills(studentFk: number, versionNo: number): VersionSkill[] {
  return getDb()
    .prepare(
      `SELECT a.record_id AS recordId, a.skill_name AS name, a.skill_category AS category,
              a.badge_code AS badgeCode, a.description, a.date_earned AS dateEarned
         FROM passports p
         JOIN passport_versions v ON v.passport_fk = p.id AND v.version_no = ?
         JOIN version_source_records x ON x.version_fk = v.id
         JOIN skill_awards a ON a.record_id = x.record_id AND a.student_fk = p.student_fk
        WHERE p.student_fk = ?
        ORDER BY a.date_earned, a.record_id`,
    )
    .all(versionNo, studentFk) as VersionSkill[];
}

/** For a student without a passport: how many skills BTU has recorded and whether any are on hold. */
export function getPendingInfo(studentFk: number): { awards: number; held: number } {
  const db = getDb();
  const student = db.prepare("SELECT student_id FROM students WHERE id = ?").get(studentFk) as { student_id: string };
  const awards = db.prepare("SELECT COUNT(*) AS n FROM skill_awards WHERE student_fk = ?").get(studentFk) as { n: number };
  const held = db
    .prepare("SELECT COUNT(*) AS n FROM source_records WHERE student_code = ? AND state = 'HELD'")
    .get(student.student_id) as { n: number };
  return { awards: awards.n, held: held.n };
}

/**
 * The most recent failed attempt to generate a newer version of this student's passport, if it
 * happened after the current version and its skills are still missing from it.
 */
export function getUnresolvedFailure(studentFk: number): { at: string } | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT f.created_at AS at, f.record_ids_json AS ids, cur.id AS currentId, cur.issued_at AS currentAt
         FROM generation_failures f
         JOIN passports p ON p.id = f.passport_fk AND p.student_fk = ?
         LEFT JOIN passport_versions cur ON cur.passport_fk = p.id AND cur.status = 'CURRENT'
        ORDER BY f.id DESC LIMIT 1`,
    )
    .get(studentFk) as { at: string; ids: string; currentId: number | null; currentAt: string | null } | undefined;
  if (!row || (row.currentAt && row.currentAt > row.at)) return null;
  // skills already in the current version or in a version waiting for registration are not failed
  const covered = new Set(
    (
      db
        .prepare(
          `SELECT record_id FROM version_source_records WHERE version_fk = ?
           UNION SELECT x.record_id FROM candidate_records x
             JOIN version_candidates c ON c.id = x.candidate_fk AND c.state = 'AWAITING_REGISTRATION'
             JOIN passports p ON p.id = c.passport_fk AND p.student_fk = ?`,
        )
        .all(row.currentId ?? -1, studentFk) as { record_id: string }[]
    ).map((r) => r.record_id),
  );
  return (JSON.parse(row.ids) as string[]).some((id) => !covered.has(id)) ? { at: row.at } : null;
}

/**
 * A newer version that has been generated and checked but is not issued yet, because its blockchain
 * registration hasn't happened. Only its number and date are exposed; its PDF is never served.
 */
export function getWaitingVersion(studentFk: number): { versionNo: number; generatedAt: string } | null {
  const row = getDb()
    .prepare(
      `SELECT c.version_no AS versionNo, c.generated_at AS generatedAt
         FROM version_candidates c JOIN passports p ON p.id = c.passport_fk
        WHERE p.student_fk = ? AND c.state = 'AWAITING_REGISTRATION'`,
    )
    .get(studentFk) as { versionNo: number; generatedAt: string } | undefined;
  return row ?? null;
}
