import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth/staff";
import { audit } from "@/lib/audit";
import { courseRows, KINDS, TIER_LABEL } from "@/lib/subjects";

// GET /api/admin/courses  -> CSV, one line per student per course (any staff role; the download is audited)
export async function GET() {
  const staff = await getCurrentStaff();
  if (!staff) return new NextResponse("Staff sign-in required.", { status: 401 });
  const rows = courseRows();
  const head = ["Student ID", "First name", "Last name", "Email", "Program", "Education level", "Status",
    "Course code", "Course", "Course (ka)", "ECTS", "Syllabus version", ...KINDS.map((k) => k[0] + k.slice(1).toLowerCase()),
    "Total (of 100)", "Badge", "Result"];
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // quoted, and a leading = + - @ is defused so a spreadsheet never runs it as a formula
    return `"${(/^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? "'" + s : s).replaceAll('"', '""')}"`;
  };
  const lines = rows.map((r) => [r.studentId, r.firstName, r.lastName, r.email, r.program, r.educationLevel, r.status,
    r.subjectCode, r.subjectEn, r.subjectKa, r.credits, r.syllabusVersion, ...KINDS.map((k) => (k in r.points ? r.points[k] : "n/a")),
    r.total, r.tier ? TIER_LABEL[r.tier] : "", r.resultStatus === "COMPLETE" ? "Complete" : "In progress"].map(cell).join(","));
  audit({ kind: "STAFF", ref: staff.email }, "COURSE_RESULTS_EXPORTED", null, { rows: rows.length });
  return new NextResponse("﻿" + [head.map(cell).join(","), ...lines].join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="course-results.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
