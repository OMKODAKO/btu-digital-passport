import { requireStaff } from "@/lib/auth/staff";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "BTU passport admin" };

// Every page in this group also calls requireStaff() itself; this layout only adds the frame.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const real = (getDb().prepare("SELECT COUNT(*) AS n FROM students WHERE source NOT IN ('BTU_TEST_DATA', 'SEED_SYNTHETIC')").get() as { n: number }).n;
  return (
    <div className="shell">
      <aside className="sidebar">
        <p className="sidebar-term">AI Skills Passport · 2026</p>
        <p className="sidebar-section">მართვა</p>
        <nav className="sidebar-nav adminnav">
          <a href="/admin">მიმოხილვა · Overview</a>
          <a href="/admin/students">სტუდენტის ძებნა</a>
          <a href="/admin/issues">იმპორტის პრობლემები</a>
          <a href="/admin/audit">აუდიტის ჟურნალი</a>
          <a href="/verify">საჯარო ვერიფიკაცია</a>
        </nav>
        <p className="sidebar-section">ანგარიში</p>
        <form method="post" action="/api/admin/logout" className="sidebar-who">
          <span className="muted">
            {staff.displayName}
            <br />
            <span data-testid="staff-role">{staff.role}</span>
            {staff.isDemo && " · demo account"}
          </span>
          <button type="submit" className="button">
            Sign out
          </button>
        </form>
      </aside>
      <main className="shell-main">
        {real === 0 && (
          <p className="alert info" data-testid="demo-banner">
            Demo environment: every record here is BTU hackathon test data or synthetic demo data, not real institutional
            data. Passports are registered on the public Ethereum Sepolia test network by a test issuer.
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
