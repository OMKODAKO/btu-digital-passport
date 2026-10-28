/**
 * What the passport booklet on the dashboard (src/components/PassportBook.tsx) shows, as one plain structure.
 *
 * The booklet is a view of one issued version, not a second document: its holder, skills and subject badges are
 * read from the passport-data.json the worker embedded in that version's stored PDF (worker/pdf/model.py
 * canonical_payload, checked against the certified data before issue). The caller passes the bytes only after
 * readVersionPdf checked them against the recorded SHA-256, so the booklet and the PDF download are always the
 * same version with the same data. The verification claims (claimsFor, shown beside the booklet) come from the dashboard's live check (verifyVersion);
 * nothing here turns a missing or failed check into a pass.
 */
import { inflateSync } from "node:zlib";
import type { Passport, PassportVersion } from "./passports";
import type { VerificationResult } from "./verify";
import { ectsLabel, isSheetSkill, studentResults, TIER_LABEL, type Tier } from "./subjects";

/** The fields of passport-data.json the booklet reads (see canonical_payload). */
type Payload = {
  passport_id: string;
  first_name: string;
  last_name: string;
  first_issued: string;
  version: number;
  issued_at: string;
  program?: string;
  education_level?: string;
  skills: { record_id: string; skill_id: string; name: string; category: string; badge_code: string; description: string;
    date_earned: string; earned_through?: string }[];
  subject_badges?: { code: string; name_en: string; name_ka: string; credits: number; syllabus_version: number; score: string;
    tier: Tier; description?: string; date_earned?: string; category?: string; badge_code?: string }[];
};

export type ClaimState = "ok" | "pending" | "partial" | "failed" | "none" | "unknown";
export type Claim = { key: "record" | "integrity" | "chain" | "official"; label: string; state: ClaimState; text: string };

export type BookEvidence = {
  kind: "assessment" | "project" | "record";
  title: string;
  result: string;
  explanation: string;
  source: string;
};
export type BookSkill = {
  id: string;
  name: string;
  group: "subject" | "skill";
  meta: string; // "Subject badge · 6 ECTS", "AI Applied Skill · BDG-AI-002"
  level: string; // "Gold", "AI Applied Skill"
  score: string | null; // only for scored subjects and skills ("84.50" of 100)
  tier: Tier | null; // a scored skill's stamp is printed in its tier's ink
  category: string | null; // sheet skill category, picks the stamp
  evidence: BookEvidence[];
  evidenceNote: string | null;
};
export type BookCourse = { code: string; nameEn: string; nameKa: string; credits: string; score: string; tier: Tier; completed: string | null };
export type BookVersion = { versionNo: number; issuedOn: string; current: boolean; registered: boolean; selected: boolean; href: string };
export type BookData = {
  demoLabel: string | null; // "BTU test data" / "Demo data" on the cover and every page footer, null for a real record
  testIssuer: boolean; // registered by the hackathon TEST issuer
  holder: { fullName: string; program: string | null; level: string | null; passportId: string; firstIssued: string };
  journey: { summary: string; courses: BookCourse[] };
  skills: BookSkill[];
  issue: {
    versionNo: number;
    current: boolean;
    issuedOn: string;
    verificationCode: string;
    registered: boolean;
    network: string | null;
    block: number | null;
    verifyHref: string | null;
  };
  versions: BookVersion[];
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * passport-data.json from a stored passport PDF, or null. PyMuPDF writes it as one /EmbeddedFile stream
 * (FlateDecode); the stream is found by its dictionary, inflated and accepted only if it is this passport's data.
 */
export function readEmbeddedPayload(pdf: Buffer, passportId: string, versionNo: number): Payload | null {
  const text = pdf.toString("latin1");
  const marker = /\/Type\s*\/EmbeddedFile\b/g;
  for (let m = marker.exec(text); m; m = marker.exec(text)) {
    const dictStart = text.lastIndexOf("obj", m.index);
    const streamAt = text.indexOf("stream", m.index);
    if (dictStart < 0 || streamAt < 0) continue;
    const dict = text.slice(dictStart, streamAt);
    let start = streamAt + "stream".length;
    if (text[start] === "\r") start++;
    if (text[start] === "\n") start++;
    const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    const end = len ? start + Number(len[1]) : text.indexOf("endstream", start);
    if (end <= start) continue;
    try {
      const raw = pdf.subarray(start, end);
      const body = /\/FlateDecode/.test(dict) ? inflateSync(raw) : raw;
      const data = JSON.parse(body.toString("utf8")) as Payload;
      if (data.passport_id === passportId && data.version === versionNo && Array.isArray(data.skills)) return data;
    } catch {
      // not this stream, or not readable: try the next one
    }
  }
  return null;
}

/**
 * The four claims a reader may care about, kept apart: a found record, an unchanged document, a confirmed
 * transaction and an official BTU issuer are different statements, and each is only "ok" when its own check passed.
 */
export function claimsFor(version: PassportVersion, pdfOk: boolean, v: VerificationResult | null): Claim[] {
  const registered = !!version.chainTxHash;
  const e = v?.evidence;
  const record: Claim = { key: "record", label: "Issuance record", state: "none", text: "" };
  const integrity: Claim = { key: "integrity", label: "Document integrity", state: "none", text: "" };
  const chain: Claim = { key: "chain", label: "Blockchain transaction", state: "none", text: "" };
  const official: Claim = { key: "official", label: "Official BTU issuance", state: "none", text: "" };

  if (!registered || !v) {
    record.text = "Not registered on a blockchain, so there is no public issuance record for this version.";
    integrity.state = pdfOk ? "partial" : "failed";
    integrity.text = pdfOk
      ? "The stored PDF matches the hash the portal recorded at issue. There is no blockchain record to check it against."
      : "The stored PDF is missing or no longer matches the hash recorded at issue.";
    chain.text = "No blockchain transaction exists for this version.";
    official.text = "Cannot be checked without a blockchain record.";
    return [record, integrity, chain, official];
  }

  record.state = v.record === "FOUND" ? "ok" : v.record === "NOT_FOUND" ? "failed" : "unknown";
  record.text = {
    FOUND: `Found in the passport registry: V${e!.versionNo}${e!.registeredAt ? `, registered ${fmtDate(e!.registeredAt)}` : ""}.`,
    NOT_FOUND: "The registry has no record for this verification code.",
    UNAVAILABLE: "The registry could not be read just now.",
  }[v.record];

  integrity.state = v.file === "MATCH" ? "ok" : v.file === "MISMATCH" ? "failed" : "unknown";
  integrity.text =
    v.file === "MATCH"
      ? "Verified: the stored PDF's SHA-256 equals the hash in the blockchain record."
      : v.file === "MISMATCH"
        ? "The stored PDF does not match the hash in the blockchain record."
        : pdfOk
          ? "Not compared with the blockchain record, because the record could not be read."
          : "The stored PDF is missing or failed its integrity check.";

  chain.state = v.chain === "CONFIRMED" ? "ok" : v.chain === "PENDING" ? "pending" : v.chain === "NONE" ? "failed" : "unknown";
  chain.text = {
    CONFIRMED: `Confirmed in block ${e!.blockNumber} with ${e!.confirmations} confirmation${e!.confirmations === 1 ? "" : "s"}${e!.network ? ` on ${e!.network}` : ""}.`,
    PENDING: `Waiting for confirmations (${e!.confirmations} of ${e!.requiredConfirmations}).`,
    NONE: "No blockchain record exists for this verification code.",
    UNAVAILABLE: "The blockchain could not be reached just now.",
  }[v.chain];

  official.state = v.issuer === "VERIFIED_BTU" ? "ok" : v.issuer === "TEST_ISSUER" ? "pending" : v.issuer === "NOT_VERIFIED" ? "failed" : "unknown";
  official.text = {
    VERIFIED_BTU: `Verified: recorded by ${e!.issuerLabel ?? "an issuer"} that BTU authorises.`,
    TEST_ISSUER: "Pending. This version was recorded by the hackathon test issuer; official BTU issuer verification has not been completed.",
    NOT_VERIFIED: "Not verified: the record was not written by an issuer BTU authorises.",
    UNAVAILABLE: "The issuer could not be checked just now.",
  }[v.issuer];
  return [record, integrity, chain, official];
}

export function bookForVersion(input: {
  student: { id: number; source: string };
  passport: Passport;
  version: PassportVersion;
  pdf: Buffer;
}): BookData | null {
  const { student, passport, version, pdf } = input;
  const data = readEmbeddedPayload(pdf, passport.passportId, version.versionNo);
  if (!data) return null;

  // Component marks explain a certified score only while they still add up to it under the same syllabus.
  const results = new Map(studentResults(student.id).map((r) => [r.subject.code, r]));
  const subjects = data.subject_badges ?? [];

  const marksFor = (b: (typeof subjects)[number]) => {
    const r = results.get(b.code);
    const same = !!r && r.syllabusVersion === b.syllabus_version && r.score === b.score;
    const evidence: BookEvidence[] = same
      ? r.subject.components.map((c) => ({
          kind: c.kind === "PROJECT" ? "project" : "assessment",
          title: c.label,
          result: `${pts(r.marks[c.label])} / ${pts(c.maxPoints)}`,
          explanation: `${c.kind === "PROJECT" ? "Project work" : `Graded ${c.kind.toLowerCase()}`}, worth ${pts(c.weight)} of the course's 100 points.`,
          source: `Grade record · ${b.code} · syllabus v${b.syllabus_version}${r.subject.simulated ? " (simulated syllabus)" : ""}`,
        }))
      : [];
    const evidenceNote = same
      ? null
      : `Certified score ${b.score} / 100 under syllabus v${b.syllabus_version}. The marks on record have changed since this version was issued, so they are not listed here.`;
    return { evidence, evidenceNote };
  };

  // A sheet skill whose course is marked is shown once, as the skill with its score and tier, not again as a badge.
  const sheetIds = new Set(data.skills.map((k) => k.skill_id));
  const scoreOf = new Map(subjects.filter((b) => isSheetSkill(b.code)).map((b) => [b.code, b]));

  const subjectSkills: BookSkill[] = subjects.filter((b) => !sheetIds.has(b.code)).map((b) => {
    const { evidence, evidenceNote } = marksFor(b);
    return {
      id: b.code,
      name: b.name_en,
      group: "subject",
      meta: isSheetSkill(b.code) ? `Skill course${b.category ? ` · ${b.category}` : ""}` : `Subject · ${ectsLabel(b.code, b.credits)} ECTS`,
      level: TIER_LABEL[b.tier],
      score: b.score,
      tier: b.tier,
      category: null,
      evidence,
      evidenceNote,
    };
  });

  const sheetSkills: BookSkill[] = data.skills.map((k) => {
    const b = scoreOf.get(k.skill_id);
    const marks = b ? marksFor(b) : { evidence: [], evidenceNote: null };
    return {
      id: k.record_id,
      name: k.name,
      group: "skill",
      meta: `${k.category} · ${k.badge_code}`,
      level: b ? TIER_LABEL[b.tier] : k.category,
      score: b ? b.score : null, // only once the skill's course is marked
      tier: b ? b.tier : null,
      category: k.category,
      evidence: [
        ...marks.evidence,
        {
          kind: "record",
          title: k.earned_through || "Confirmed skill",
          result: fmtDate(k.date_earned),
          explanation: k.description || "Confirmed in BTU's skill records.",
          source: `Skill record ${k.record_id} · ${k.skill_id} · badge ${k.badge_code}`,
        },
      ],
      evidenceNote: marks.evidenceNote,
    };
  });

  const ects = subjects.filter((b) => !isSheetSkill(b.code)).reduce((n, b) => n + b.credits, 0);
  const summary = subjects.length
    ? `${subjects.length} completed subject${subjects.length === 1 ? "" : "s"} at badge level in this version` +
      (ects ? `, ${ects} ECTS in total.` : ".")
    : "No subject badges are certified in this version. Its skills come from BTU's skill records.";

  return {
    demoLabel: student.source === "BTU_TEST_DATA" ? "BTU test data" : student.source === "SEED_SYNTHETIC" ? "Demo data" : null,
    testIssuer: !!version.chainTxHash && version.chainIssuerTestOnly !== 0,
    holder: {
      fullName: `${data.first_name} ${data.last_name}`,
      program: data.program || null,
      level: data.education_level || null,
      passportId: data.passport_id,
      firstIssued: fmtDate(data.first_issued),
    },
    journey: {
      summary,
      courses: subjects.map((b) => ({
        code: b.code, nameEn: b.name_en, nameKa: b.name_ka, credits: ectsLabel(b.code, b.credits), score: b.score, tier: b.tier,
        completed: b.date_earned ? fmtDate(b.date_earned) : null,
      })),
    },
    skills: [...subjectSkills, ...sheetSkills],
    issue: {
      versionNo: version.versionNo,
      current: version.status === "CURRENT",
      issuedOn: fmtDate(data.issued_at),
      verificationCode: version.verificationCode,
      registered: !!version.chainTxHash,
      network: version.chainNetwork,
      block: version.chainBlockNumber,
      verifyHref: version.chainTxHash ? `/verify/${version.verificationCode}` : null,
    },
    versions: passport.versions.map((x) => ({
      versionNo: x.versionNo,
      issuedOn: fmtDate(x.issuedAt),
      current: x.status === "CURRENT",
      registered: !!x.chainTxHash,
      selected: x.versionNo === version.versionNo,
      href: x.status === "CURRENT" ? "/dashboard" : `/dashboard?v=${x.versionNo}`,
    })),
  };
}
