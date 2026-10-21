// Load test for the public verifier, POST /api/verify: N requests at concurrency C, each uploading a
// real PDF with its code, against a running server.
//   node scripts/scale/load_verify.mjs http://127.0.0.1:3000 BTU-XXXX-XXXX-XXXX passport.pdf [N=500] [C=20]
// Each request sends its own X-Forwarded-For so the per-client limit (30 per 5 min) doesn't stop the test.
import fs from "node:fs";

const [base, code, pdfPath, N = "500", C = "20"] = process.argv.slice(2);
const pdf = fs.readFileSync(pdfPath);
const times = [];
let ok = 0, bad = 0, next = 0;

async function worker() {
  while (next < Number(N)) {
    const n = next++;
    const form = new FormData();
    form.set("code", code);
    form.set("pdf", new Blob([pdf], { type: "application/pdf" }), "passport.pdf");
    const t = performance.now();
    const res = await fetch(`${base}/api/verify`, { method: "POST", body: form,
      headers: { "x-forwarded-for": `10.0.${n >> 8}.${n & 255}` } });
    const body = await res.json();
    times.push(performance.now() - t);
    if (res.status === 200 && body.file === "MATCH") ok++;
    else bad++;
  }
}

const t0 = performance.now();
await Promise.all(Array.from({ length: Number(C) }, worker));
const secs = (performance.now() - t0) / 1000;
times.sort((a, b) => a - b);
const p = (q) => Math.round(times[Math.floor(q * (times.length - 1))]);
console.log(JSON.stringify({ requests: Number(N), concurrency: Number(C), ok, bad, seconds: +secs.toFixed(1),
  per_second: +(Number(N) / secs).toFixed(1), p50_ms: p(0.5), p95_ms: p(0.95), max_ms: p(1) }));
