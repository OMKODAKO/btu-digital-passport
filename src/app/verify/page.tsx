import VerifyForm from "./VerifyForm";
import Hero from "@/components/Hero";

export const metadata = { title: "Verify a BTU AI Skills Digital Passport" };

export default function VerifyPage() {
  return <VerifyShell />;
}

export function VerifyShell({ code }: { code?: string }) {
  return (
    <>
    <Hero title="Verify a passport" sub="ვერიფიკაცია · No account needed" />
    <main className="page narrow">
      <header>
        <p className="eyebrow">BTU AI Skills Digital Passport</p>
        <h1>Verify a passport</h1>
        <p className="muted">
          Enter the verification code printed on the passport. Upload the PDF too, to check that the document itself is
          the one BTU issued. No account is needed.
        </p>
      </header>
      <VerifyForm initialCode={code} />
      <p className="fine">
        Prototype: records are on the public Ethereum Sepolia test network and the issuer is a test issuer, so no
        result here is an official BTU verification yet.
      </p>
    </main>
    </>
  );
}
