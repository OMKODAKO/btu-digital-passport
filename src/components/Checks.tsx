import type { VerificationResult } from "@/lib/verify";

// Shared by the public verification page and the student dashboard, so both describe a result in
// exactly the same words. Each check is shown on its own; nothing is merged into one "authentic".

export const HEADLINES: Record<VerificationResult["overall"], { title: string; tone: "ok" | "warn" | "bad" }> = {
  AUTHENTIC_CURRENT: { title: "Authentic: this is the current BTU passport", tone: "ok" },
  AUTHENTIC_HISTORICAL: { title: "Authentic historical version: superseded, not the current passport", tone: "ok" },
  RECORD_VALID_FILE_NOT_CHECKED: { title: "Valid BTU issuance record; upload the PDF to check the document itself", tone: "ok" },
  TEST_ISSUER_ONLY: { title: "Not verified as an official BTU issuance: issued by a test issuer", tone: "warn" },
  PENDING_CONFIRMATION: { title: "Not yet verifiable: the blockchain record is still being confirmed", tone: "warn" },
  NOT_VERIFIED: { title: "Not verified", tone: "bad" },
  UNAVAILABLE: { title: "Verification could not be completed right now", tone: "warn" },
};

/**
 * The headline for a result. With a TEST issuer the result is never an official BTU issuance, but the
 * document checks still differ (current, historical, code only), so the headline says which, and
 * names the test issuer in the same sentence.
 */
export function headline(r: VerificationResult): { title: string; tone: "ok" | "warn" | "bad" } {
  if (r.overall !== "TEST_ISSUER_ONLY") return HEADLINES[r.overall];
  const test = "issued by BTU's hackathon TEST issuer, not yet an official BTU issuance";
  if (r.file === "MATCH" && r.version === "CURRENT")
    return { title: `Document authentic and current (unchanged since issue); ${test}`, tone: "warn" };
  if (r.file === "MATCH" && r.version === "SUPERSEDED")
    return { title: `Document authentic, historical version (superseded, not current); ${test}`, tone: "warn" };
  if (r.file === "NOT_PROVIDED")
    return { title: `Issuance record found; upload the PDF to check the document itself. Record ${test}`, tone: "warn" };
  return HEADLINES[r.overall];
}

type Line = { label: string; state: string; good: boolean | null; text: string };

export function lines(r: VerificationResult, stored = false): Line[] {
  const e = r.evidence;
  const date = e.registeredAt ? new Date(e.registeredAt).toUTCString().slice(5, 22) + " UTC" : "";
  return [
    {
      label: "Issuance record",
      state: r.record,
      good: r.record === "FOUND" ? true : r.record === "NOT_FOUND" ? false : null,
      text: {
        FOUND: `Found: passport version V${e.versionNo}, registered ${date}.`,
        NOT_FOUND: "No issued passport version has this verification code.",
        UNAVAILABLE: "Could not be checked.",
      }[r.record],
    },
    {
      label: "Blockchain record",
      state: r.chain,
      good: r.chain === "CONFIRMED" ? true : r.chain === "NONE" ? false : null,
      text: {
        CONFIRMED: `Confirmed: ${e.confirmations} confirmations, block ${e.blockNumber}.`,
        PENDING: `Registered but not yet confirmed (${e.confirmations} of ${e.requiredConfirmations} confirmations).`,
        NONE: "There is no blockchain record for this code.",
        UNAVAILABLE: "The blockchain could not be reached or read.",
      }[r.chain],
    },
    {
      label: "File integrity",
      state: r.file,
      good: r.file === "MATCH" ? true : r.file === "MISMATCH" ? false : null,
      text: {
        MATCH: stored
          ? "Your PDF stored at BTU is exactly the registered file: its SHA-256 matches the recorded hash."
          : "The uploaded PDF is exactly the issued file: its SHA-256 matches the recorded hash.",
        MISMATCH: stored
          ? "Your stored PDF does not match the registered hash."
          : "The uploaded PDF is not the issued file: it has been changed, or it is a different document.",
        NOT_PROVIDED: "No PDF was uploaded, so only the code was checked, not a document.",
        NOT_CHECKED: "The uploaded PDF could not be compared with a record.",
      }[r.file],
    },
    {
      label: "BTU issuer identity",
      state: r.issuer,
      good: r.issuer === "VERIFIED_BTU" ? true : r.issuer === "NOT_VERIFIED" ? false : null,
      text: {
        VERIFIED_BTU: `Verified: written by ${e.issuerLabel ?? "an issuer"} that BTU authorises.`,
        TEST_ISSUER: "Test issuer only. Official BTU issuer verification is still pending, so this is not proof of an official BTU issuance.",
        NOT_VERIFIED: "Not verified: the record was not written by an issuer BTU authorises.",
        UNAVAILABLE: "Could not be checked.",
      }[r.issuer],
    },
    {
      label: "Version status",
      state: r.version,
      good: r.version === "CURRENT" ? true : null,
      text: {
        CURRENT: "Current: this is the latest issued version of the passport.",
        SUPERSEDED: "Superseded: a later version exists. This one is historical, not the current passport.",
        UNKNOWN: "Unknown.",
      }[r.version],
    },
  ];
}

export default function Checks({ result, stored = false }: { result: VerificationResult; stored?: boolean }) {
  return (
    <ul className="checks">
      {lines(result, stored).map((l) => (
        <li key={l.label} data-check={l.label} data-state={l.state}>
          <span className={`mark ${l.good === true ? "ok" : l.good === false ? "bad" : "warn"}`} aria-hidden>
            {l.good === true ? "✓" : l.good === false ? "✗" : "!"}
          </span>
          <span>
            <strong>{l.label}</strong>
            <span className="muted"> {l.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
