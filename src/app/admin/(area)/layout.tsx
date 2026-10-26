import AdminTabs from "@/components/AdminTabs";
import AppHeader from "@/components/AppHeader";
import PassportFrame from "@/components/PassportFrame";
import { requireStaff } from "@/lib/auth/staff";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "BTU passport admin" };

// Every page in this group also calls requireStaff() itself; this layout only adds the frame.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const real = (getDb().prepare("SELECT COUNT(*) AS n FROM students WHERE source NOT IN ('BTU_TEST_DATA', 'SEED_SYNTHETIC')").get() as { n: number }).n;
  return (
    <>
      <AppHeader area="staff" home="/admin">
        <span className="appbar-user">
          {staff.displayName} · <span data-testid="staff-role">{staff.role}</span>
          {staff.isDemo && " · demo account"}
        </span>
        <form method="post" action="/api/admin/logout">
          <button type="submit" className="button ghost">
            Sign out
          </button>
        </form>
      </AppHeader>
      <PassportFrame>
        <AdminTabs />
        <div className="lp-sheet pp-admin">
        {real === 0 && (
          <p className="alert info" data-testid="demo-banner">
            Demo environment: every record here is BTU hackathon test data or synthetic demo data, not real institutional
            data. Passports are registered on the public Ethereum Sepolia test network by a test issuer.
          </p>
        )}
        {children}
        </div>
      </PassportFrame>
    </>
  );
}
