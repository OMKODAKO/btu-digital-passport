import AppHeader from "@/components/AppHeader";
import VerifyForm from "./VerifyForm";

export const metadata = { title: "Verify a BTU AI Skills Digital Passport" };

export default function VerifyPage() {
  return <VerifyShell />;
}

export function VerifyShell({ code }: { code?: string }) {
  return (
    <>
    <AppHeader area="public" home="/verify">
      <a className="appbar-link" href="/login">Student sign-in</a>
    </AppHeader>
    <main className="page narrow">
      <header className="page-head">
        <p className="eyebrow">Public verification · ვერიფიკაცია</p>
        <h1>Verify a passport</h1>
        <p className="muted">
          Enter the verification code printed on the passport. Upload the PDF too, to check that the document itself is
          the one BTU issued. No account is needed.
        </p>
      </header>
      <VerifyForm initialCode={code} />
      <p className="fine">
        Prototype: records are on the public Ethereum Sepolia test network and the issuer is a test issuer, so no result here is an
        official BTU verification yet.
      </p>
    </main>
    </>
  );
}
