import AppHeader from "@/components/AppHeader";
import PassportBook from "@/components/PassportBook";
import PassportFrame from "@/components/PassportFrame";
import { DEMO_BOOK } from "@/demo/passport-book-demo";

export const metadata = {
  title: "Demo passport · BTU AI Skills Digital Passport",
  description: "An interactive demo of the AI Skills Digital Passport booklet, with a fictional student.",
};

/* The public demo booklet. Its data is the isolated fixture in src/demo, never a student record. */
export default function DemoPassport() {
  return (
    <>
      <AppHeader area="public" home="/">
        <a className="appbar-link" href="/verify">Verify a passport</a>
        <a className="appbar-link" href="/login">Student sign-in</a>
      </AppHeader>
      <PassportFrame note="დემო: გამოგონილი სტუდენტი და ქულები. BTU-ს მიერ არ არის გაცემული და ბლოკჩეინზე არ არის.">
        <section className="lp-book" aria-labelledby="book-title">
          <h1 id="book-title" className="lp-book-title">
            <strong>Demo</strong> passport
          </h1>
          <p className="lp-book-lead">
            გახსენი პასპორტი და გადაფურცლე: იდენტობა, აკადემიური გზა, უნარები, მტკიცებულებები და ბეჯები. ყველა მონაცემი
            გამოგონილია და მხოლოდ საჩვენებელია.
          </p>
          <PassportBook data={DEMO_BOOK} homeHref="/" homeLabel="Home" />
        </section>
      </PassportFrame>
    </>
  );
}
