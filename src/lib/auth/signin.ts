import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_HOURS, STAFF_COOKIE, STAFF_SESSION_HOURS } from "../config";
import { cookieOptions, createSession, deleteSession } from "./session";
import { createStaffSession, deleteStaffSession, staffCookieOptions } from "./staff";

/**
 * Starts a session for someone a sign-in method has already identified (Google, demo or password) and sets its
 * cookie on the response. One role per browser: a student sign-in ends any staff session here, and the other way.
 */
export async function signInStudent(res: NextResponse, studentFk: number, method: "password" | "google" | "demo") {
  res.cookies.set(SESSION_COOKIE, createSession(studentFk, method), { ...cookieOptions, maxAge: SESSION_HOURS * 3600 });
  const staffToken = (await cookies()).get(STAFF_COOKIE)?.value;
  if (staffToken) {
    deleteStaffSession(staffToken);
    res.cookies.set(STAFF_COOKIE, "", { ...staffCookieOptions, maxAge: 0 });
  }
  return res;
}

export async function signInStaff(res: NextResponse, staffFk: number) {
  res.cookies.set(STAFF_COOKIE, createStaffSession(staffFk), { ...staffCookieOptions, maxAge: STAFF_SESSION_HOURS * 3600 });
  const studentToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (studentToken) {
    deleteSession(studentToken);
    res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  }
  return res;
}
