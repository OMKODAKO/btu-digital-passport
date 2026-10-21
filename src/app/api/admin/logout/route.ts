import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { deleteStaffSession, getCurrentStaff, staffCookieOptions } from "@/lib/auth/staff";
import { audit } from "@/lib/audit";
import { STAFF_COOKIE } from "@/lib/config";
import { isSameOrigin, redirect } from "@/lib/request";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return new NextResponse("Forbidden", { status: 403 });
  const staff = await getCurrentStaff();
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  if (token) deleteStaffSession(token);
  if (staff) audit({ kind: "STAFF", ref: staff.email }, "STAFF_LOGOUT");
  const res = redirect("/admin/login?signedout=1");
  res.cookies.set(STAFF_COOKIE, "", { ...staffCookieOptions, maxAge: 0 });
  return res;
}
