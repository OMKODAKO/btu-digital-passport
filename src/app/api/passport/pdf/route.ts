import { NextResponse } from "next/server";
import { getCurrentStudent } from "@/lib/auth/session";
import { getPassportForStudent, readVersionPdf } from "@/lib/passports";

// GET /api/passport/pdf            the signed-in student's current PDF, shown inline
// GET /api/passport/pdf?v=1        an older version of the same student's passport
// GET /api/passport/pdf?download=1 the same bytes as a file download
//
// The student comes only from the session. There is no student, passport or file
// parameter; the only choice the browser has is a version number of its own passport.
export async function GET(req: Request) {
  const student = await getCurrentStudent();
  if (!student) return text(401, "Sign in to view your passport.");

  const passport = getPassportForStudent(student.id);
  if (!passport) return text(404, "No passport has been generated for this account yet.");

  const url = new URL(req.url);
  const v = url.searchParams.get("v");
  const version = v === null ? passport.current : passport.versions.find((x) => String(x.versionNo) === v);
  if (!version) return text(404, "That version of your passport does not exist.");

  const pdf = readVersionPdf(version);
  if (!pdf.ok) {
    return pdf.reason === "missing"
      ? text(404, "The PDF file for this version is missing. Please contact BTU.")
      : text(500, "The stored PDF failed its integrity check and was not sent. Please contact BTU.");
  }

  const filename = `${passport.passportId}_V${version.versionNo}.pdf`;
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Content-Length": String(pdf.bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "frame-ancestors 'self'",
    },
  });
}

function text(status: number, message: string) {
  return new NextResponse(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
