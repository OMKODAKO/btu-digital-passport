import type { AuditEntry } from "@/lib/admin";
import { fmt } from "../format";

export default function AuditTable({ entries, showPassport = false }: { entries: AuditEntry[]; showPassport?: boolean }) {
  if (entries.length === 0) return <p className="muted">No entries yet.</p>;
  return (
    <table className="table" data-testid="audit">
      <thead>
        <tr><th>When</th><th>Who</th><th>Action</th>{showPassport && <th>Passport</th>}<th>Details</th></tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id} data-action={e.action}>
            <td>{fmt(e.at)}</td>
            <td>{e.actorKind === "STAFF" ? e.actorRef : e.actorKind.toLowerCase()}</td>
            <td>{e.action}</td>
            {showPassport && <td className="mono">{e.passportId ?? ""}</td>}
            <td className="muted details">
              {e.details ? Object.entries(JSON.parse(e.details) as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("; ") : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
