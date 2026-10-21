import { MAX_UPLOAD_BYTES, normaliseCode, verifyVersion } from "@/lib/verify";

// Public endpoint: no session, no cookies read. Body: multipart form with `code` and optional `pdf`.
const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 30;
const hits = new Map<string, number[]>();

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear();
  return recent.length > MAX_REQUESTS;
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Reads at most `limit` bytes of the body; returns null if it is larger. */
async function readCapped(req: Request, limit: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  if (limited(ip)) return json({ error: "Too many verification requests. Try again in a few minutes." }, 429);

  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data")) return json({ error: "Send the form as multipart/form-data." }, 415);
  const limit = MAX_UPLOAD_BYTES + 64 * 1024; // the file plus form overhead
  if (Number(req.headers.get("content-length") ?? 0) > limit) return json({ error: "The file is larger than 10 MB." }, 413);
  const body = await readCapped(req, limit);
  if (!body) return json({ error: "The file is larger than 10 MB." }, 413);

  let form: FormData;
  try {
    form = await new Response(Buffer.from(body), { headers: { "content-type": type } }).formData();
  } catch {
    return json({ error: "The form could not be read." }, 400);
  }
  const code = normaliseCode(String(form.get("code") ?? ""));
  if (!code) return json({ error: "Enter a verification code in the form BTU-XXXX-XXXX-XXXX." }, 400);

  let upload: Uint8Array | null = null;
  const file = form.get("pdf");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) return json({ error: "The file is larger than 10 MB." }, 413);
    upload = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(upload.subarray(0, 5)) !== "%PDF-") {
      return json({ error: "The uploaded file is not a PDF." }, 400);
    }
  }
  return json(await verifyVersion(code, upload));
}
