/**
 * Seeds the local database with the BTU test students and their already-generated passport PDFs.
 *
 *   npm run seed
 *
 * Source: the passport generator's registry (SEED_REGISTRY; default ../passport-generator/out/registry.json, else tests/fixtures/seed/).
 * - Students, passports and versions are inserted only if missing; existing rows are never overwritten.
 * - Each PDF is copied into DATA_DIR/storage and its SHA-256 must equal the registry's pdf_sha256,
 *   otherwise that version is skipped.
 * - A random password is created for each account that has none, and written to DATA_DIR/dev-credentials.txt
 *   (local file, ignored by git). Passwords are never printed in code or committed.
 * - Each version's Record IDs are stored in version_source_records, so the workbook import (stage 2)
 *   knows which skill records a version already contains. Re-running the seed fills these in for
 *   databases created by the stage 1 seed.
 * - One clearly labelled synthetic account without a passport is added, to show the "not generated yet" state.
 */
import { createHash, randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, STORAGE_DIR } from "../src/lib/config";
import { getDb } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";

type RegistryVersion = {
  version: number;
  status: "current" | "superseded";
  issued_at: string;
  verification_code: string;
  pdf_sha256: string;
  pdf_path: string;
  anchored_tx: string | null;
  record_ids: string[];
};
type RegistryPassport = {
  passport_id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  email: string;
  first_issued: string;
  versions: RegistryVersion[];
};

// A fresh clone has no ../passport-generator: fall back to the copy of its output kept as a test fixture
const generatorRegistry = path.resolve("../passport-generator/out/registry.json");
const registryPath = path.resolve(
  process.env.SEED_REGISTRY ??
    (fs.existsSync(generatorRegistry) ? generatorRegistry : "tests/fixtures/seed/registry.json"),
);
const registryDir = path.dirname(registryPath);
const credentialsFile = path.join(DATA_DIR, "dev-credentials.txt");

const SYNTHETIC = {
  student_id: "SEED-DEMO-0001",
  first_name: "Demo",
  last_name: "No-Passport",
  email: "demo.nopassport@example.org",
};

// 16 characters from an unambiguous alphabet, e.g. "k7wq-3mzp-9tfa-xh2c"
function newPassword(): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const chars = Array.from({ length: 16 }, () => abc[randomInt(abc.length)]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

const sha256File = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function main() {
  const db = getDb();
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")) as { passports: Record<string, RegistryPassport> };
  const created: string[] = [];
  const counts = { students: 0, passports: 0, versions: 0, contents: 0, skipped: 0 };

  const insertStudent = db.prepare(
    `INSERT INTO students (student_id, first_name, last_name, email, source) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  );
  const studentByCode = db.prepare("SELECT id, email FROM students WHERE student_id = ?");
  const insertPassport = db.prepare(
    `INSERT INTO passports (passport_id, student_fk, holder_first_name, holder_last_name, first_issued_on)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  );
  const passportById = db.prepare("SELECT id, student_fk FROM passports WHERE passport_id = ?");
  const insertVersion = db.prepare(
    `INSERT INTO passport_versions
       (passport_fk, version_no, verification_code, status, issued_at, pdf_storage_key, pdf_sha256, chain_tx_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  );

  const versionByKey = db.prepare("SELECT id, passport_fk FROM passport_versions WHERE pdf_storage_key = ?");
  const insertContent = db.prepare(
    "INSERT INTO version_source_records (version_fk, record_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
  );

  async function ensureCredential(studentFk: number, email: string) {
    const has = db.prepare("SELECT 1 FROM auth_credentials WHERE student_fk = ?").get(studentFk);
    if (has) return;
    const password = newPassword();
    db.prepare("INSERT INTO auth_credentials (student_fk, password_hash) VALUES (?, ?)").run(
      studentFk,
      await hashPassword(password),
    );
    created.push(`${email}\t${password}`);
  }

  for (const p of Object.values(registry.passports)) {
    counts.students += insertStudent.run(p.student_id, p.first_name, p.last_name, p.email, "BTU_TEST_DATA").changes;
    const student = studentByCode.get(p.student_id) as { id: number; email: string };

    counts.passports += insertPassport.run(p.passport_id, student.id, p.first_name, p.last_name, p.first_issued).changes;
    const passport = passportById.get(p.passport_id) as { id: number; student_fk: number };
    if (passport.student_fk !== student.id) {
      console.warn(`! ${p.passport_id} already belongs to another student; versions not touched`);
      continue;
    }

    for (const v of p.versions) {
      const source = path.resolve(registryDir, v.pdf_path);
      if (!fs.existsSync(source) || sha256File(source) !== v.pdf_sha256) {
        console.warn(`! ${p.passport_id} V${v.version}: PDF missing or hash differs from registry; skipped`);
        counts.skipped++;
        continue;
      }
      const key = path.posix.join("passports", p.passport_id, `V${v.version}-${v.verification_code}.pdf`);
      const target = path.join(STORAGE_DIR, key);
      if (!fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      }
      counts.versions += insertVersion.run(
        passport.id,
        v.version,
        v.verification_code,
        v.status === "current" ? "CURRENT" : "SUPERSEDED",
        v.issued_at,
        key,
        v.pdf_sha256,
        v.anchored_tx,
      ).changes;
      const versionRow = versionByKey.get(key) as { id: number; passport_fk: number } | undefined;
      if (versionRow?.passport_fk === passport.id) {
        for (const recordId of v.record_ids ?? []) counts.contents += insertContent.run(versionRow.id, recordId).changes;
      }
    }
    await ensureCredential(student.id, student.email);
  }

  counts.students += insertStudent.run(
    SYNTHETIC.student_id, SYNTHETIC.first_name, SYNTHETIC.last_name, SYNTHETIC.email, "SEED_SYNTHETIC",
  ).changes;
  const demo = studentByCode.get(SYNTHETIC.student_id) as { id: number; email: string };
  await ensureCredential(demo.id, demo.email);

  if (created.length) {
    const header = fs.existsSync(credentialsFile)
      ? ""
      : "# Local test accounts (fictional BTU test data). Generated by npm run seed. Do not commit.\n";
    fs.appendFileSync(credentialsFile, header + created.join("\n") + "\n", { mode: 0o600 });
  }

  console.log(
    `Seed done: +${counts.students} students, +${counts.passports} passports, +${counts.versions} versions, ` +
      `+${counts.contents} version record links, ` +
      `${counts.skipped} skipped, ${created.length} new passwords` +
      (created.length ? ` (see ${credentialsFile})` : ""),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
