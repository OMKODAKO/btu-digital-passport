"use client";

import { useState } from "react";

/** The student's public passport link for a CV, with a copy button. */
export default function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // no clipboard (e.g. plain http on another host): the link is still there to select
    }
  };
  return (
    <section className="cp-section" data-testid="share-link" aria-labelledby="cp-share">
      <h2 id="cp-share" className="cp-h">Link for your CV · ლინკი CV-სთვის</h2>
      <div className="share-row">
        <input className="share-url mono" readOnly value={url} aria-label="Public passport link" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="cp-fine">
        Anyone with this link sees your current passport and its AI skills and can verify it, without signing in. It never
        changes and always shows your latest version. Your email and student number are not shown. <a href={url} target="_blank" rel="noopener">Open it</a>
      </p>
    </section>
  );
}
