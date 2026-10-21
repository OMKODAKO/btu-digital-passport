"use client";

import { useEffect, useRef, useState } from "react";
import type { VerificationResult } from "@/lib/verify";
import Checks, { headline } from "@/components/Checks";

export default function VerifyForm({ initialCode = "" }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function run(form: HTMLFormElement) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/verify", { method: "POST", body: new FormData(form) });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Verification failed.");
      else setResult(body as VerificationResult);
    } catch {
      setError("The verification service could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialCode && formRef.current) void run(formRef.current);
  }, [initialCode]);

  const head = result ? headline(result) : null;
  return (
    <>
      <form
        ref={formRef}
        className="card form"
        onSubmit={(ev) => {
          ev.preventDefault();
          void run(ev.currentTarget);
        }}
      >
        <label htmlFor="code">Verification code</label>
        <input id="code" name="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="BTU-XXXX-XXXX-XXXX"
          autoComplete="off" spellCheck={false} required />
        <label htmlFor="pdf">Passport PDF (optional, up to 10 MB)</label>
        <input id="pdf" name="pdf" type="file" accept="application/pdf,.pdf" ref={fileRef} />
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Checking…" : "Verify"}
        </button>
        <p className="fine">The file is checked on BTU&apos;s server and is not stored.</p>
      </form>

      {error && (
        <p className="alert error" role="alert" data-testid="verify-error">
          {error}
        </p>
      )}

      {result && head && (
        <section className={`card verdict ${head.tone}`} data-testid="verdict" data-overall={result.overall}>
          <h2>{head.title}</h2>
          <Checks result={result} />
          {result.record === "FOUND" && (
            <dl className="evidence">
              <dt>Passport ID</dt>
              <dd>{result.evidence.passportId ?? "not available"}</dd>
              <dt>Version</dt>
              <dd>V{result.evidence.versionNo}</dd>
              <dt>Network</dt>
              <dd>{result.evidence.network ?? `chain ${result.evidence.chainId}`}</dd>
              <dt>Registry contract</dt>
              <dd className="mono">{result.evidence.registry}</dd>
              <dt>Transaction</dt>
              <dd className="mono">{result.evidence.txHash ?? "not available"}</dd>
              <dt>Issuer</dt>
              <dd>
                {result.evidence.issuerLabel} <span className="mono">{result.evidence.issuerAddress}</span>
              </dd>
              <dt>Recorded SHA-256</dt>
              <dd className="mono">{result.evidence.recordedSha256}</dd>
              {result.evidence.uploadedSha256 && (
                <>
                  <dt>Uploaded file SHA-256</dt>
                  <dd className="mono">{result.evidence.uploadedSha256}</dd>
                </>
              )}
            </dl>
          )}
        </section>
      )}
    </>
  );
}
