import { redirect } from "next/navigation";
import { getCurrentStudent } from "@/lib/auth/session";

export default async function Home() {
  redirect((await getCurrentStudent()) ? "/dashboard" : "/login");
}
