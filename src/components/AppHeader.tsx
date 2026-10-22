import type { ReactNode } from "react";

/**
 * The bar at the top of every page: BTU's official logo (taken from BTU's own passport template),
 * the product name, and whatever belongs to the current area on the right (name and sign-out).
 * Student, staff and public pages each pass their own `area`; no area links to another.
 */
export default function AppHeader({
  area,
  home,
  children,
}: {
  area: "student" | "staff" | "public";
  home: string;
  children?: ReactNode;
}) {
  return (
    <header className={`appbar appbar-${area}`}>
      <div className="appbar-inner">
        <a className="brand" href={home}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/btu-logo-white.png" alt="BTU, Business and Technology University" width={92} height={46} />
          <span className="brand-name">
            AI Skills <strong>Digital Passport</strong>
          </span>
          {area === "staff" && <span className="area-tag">Staff</span>}
        </a>
        {children && <div className="appbar-right">{children}</div>}
      </div>
    </header>
  );
}
