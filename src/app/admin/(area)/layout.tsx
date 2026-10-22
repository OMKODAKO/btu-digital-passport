import { requireStaff } from "@/lib/auth/staff";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "BTU passport admin" };

// Every page in this group also calls requireStaff() itself; this layout only adds the frame.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const real = (getDb().prepare("SELECT COUNT(*) AS n FROM students WHERE source NOT IN ('BTU_TEST_DATA', 'SEED_SYNTHETIC')").get() as { n: number }).n;
  return (
    <main className="page wide">
      <header className="topbar">
        <div>
          <p className="eyebrow">BTU AI Skills Digital Passport · staff</p>
          <nav className="adminnav">
            <a href="/admin">Overview</a>
            <a href="/admin/students">Find a student</a>
            <a href="/admin/issues">Import problems</a>
            <a href="/admin/audit">Audit log</a>
          </nav>
        </div>
        <form method="post" action="/api/admin/logout" className="who">
          <span className="muted">
            {staff.displayName} · <span data-testid="staff-role">{staff.role}</span>
            {staff.isDemo && " · demo account"}
          </span>
          <button type="submit" className="button">
            Sign out
          </button>
        </form>
      </header>
      {real === 0 && (
        <p className="alert info" data-testid="demo-banner">
          Demo environment: every record here is BTU hackathon test data or synthetic demo data, not real institutional
          data. The blockchain is the public Ethereum Sepolia test network and the issuer is a test issuer.
        </p>
      )}
      {children}
    </main>
  );
}
