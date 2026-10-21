import { normaliseCode } from "@/lib/verify";
import { VerifyShell } from "../page";

export const metadata = { title: "Verify a BTU AI Skills Digital Passport" };

// The QR code on each passport points here: /verify/<code>. The code is only pre-filled; checking
// happens through the same server-side verification as the form.
export default async function VerifyCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <VerifyShell code={normaliseCode(decodeURIComponent(code)) ?? undefined} />;
}
