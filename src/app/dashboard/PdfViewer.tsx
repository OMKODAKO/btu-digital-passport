"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Draws every page of the PDF with PDF.js, so the passport looks the same on every
 * browser (an <iframe> shows only page 1 on iPhone and nothing on Android Chrome).
 * The file comes from our own authenticated route, with the session cookie. Nothing is fetched until
 * `active` (the dashboard keeps the PDF folded away under the booklet until the student opens it).
 */
export default function PdfViewer({ src, title, active = true }: { src: string; title: string; active?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const container = box.current;
    if (!container || !active) return;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const res = await fetch(src, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
        container.replaceChildren();
        const width = container.clientWidth;
        const dpr = window.devicePixelRatio || 1;
        for (let n = 1; n <= doc.numPages && !cancelled; n++) {
          const page = await doc.getPage(n);
          const scale = width / page.getViewport({ scale: 1 }).width;
          const viewport = page.getViewport({ scale: scale * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.setAttribute("aria-label", `${title}, page ${n} of ${doc.numPages}`);
          container.appendChild(canvas);
          await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
        }
        if (!cancelled) setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, title, active]);

  return (
    <div className="pdf" data-testid="pdf-viewer" data-state={state}>
      {state === "loading" && active && <p className="muted">Loading your passport…</p>}
      {state === "error" && (
        <p className="alert error">The preview could not be shown. Use Download PDF or Open in a new tab instead.</p>
      )}
      <div ref={box} className="pages" />
    </div>
  );
}
