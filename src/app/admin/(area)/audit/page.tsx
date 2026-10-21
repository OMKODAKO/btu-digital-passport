import { requireStaff } from "@/lib/auth/staff";
import { auditActions, auditLog } from "@/lib/admin";
import AuditTable from "../AuditTable";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  await requireStaff();
  const actions = auditActions();
  const requested = (await searchParams).action;
  const action = requested && actions.includes(requested) ? requested : undefined;
  return (
    <section className="card">
      <h2>Audit log</h2>
      <form method="get" className="searchbar">
        <select name="action" defaultValue={action ?? ""} aria-label="Action">
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <button type="submit" className="button">Filter</button>
      </form>
      <p className="fine">
        Issuance, imports, retries and staff actions, newest first (latest 200). Entries can&apos;t be edited or deleted.
        Entries start with stage 6; earlier history is in the version and import tables.
      </p>
      <AuditTable entries={auditLog({ action, limit: 200 })} showPassport />
    </section>
  );
}
