import { getDb } from "./db";

/** Appends one entry to the audit log (append-only, see migration 005). Never pass secrets in details. */
export function audit(
  actor: { kind: "STAFF" | "SYSTEM"; ref: string | null },
  action: string,
  passportFk: number | null = null,
  details: Record<string, unknown> | null = null,
): void {
  getDb()
    .prepare("INSERT INTO audit_log (at, actor_kind, actor_ref, action, passport_fk, details) VALUES (?, ?, ?, ?, ?, ?)")
    .run(new Date().toISOString().slice(0, 19) + "Z", actor.kind, actor.ref, action, passportFk, details ? JSON.stringify(details) : null);
}
