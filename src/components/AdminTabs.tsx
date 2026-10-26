"use client";

import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/students", label: "Students" },
  { href: "/admin/subjects", label: "Subjects" },
  { href: "/admin/courses", label: "Course results" },
  { href: "/admin/issues", label: "Import problems" },
  { href: "/admin/audit", label: "Audit log" },
];

/** Staff-area sections; the current one is marked (orange, as in the passport) and announced to screen readers. */
export default function AdminTabs() {
  const path = usePathname();
  return (
    <nav className="pp-tabs" aria-label="Staff sections">
      <div className="pp-tabs-inner">
        {TABS.map((t) => {
          const active = t.exact ? path === t.href : path === t.href || path.startsWith(t.href + "/");
          return (
            <a key={t.href} href={t.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
              {t.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
