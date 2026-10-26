import AppHeader from "@/components/AppHeader";
import PassportFrame from "@/components/PassportFrame";
import { getCurrentStudent } from "@/lib/auth/session";

export const metadata = {
  title: "BTU AI Skills Digital Passport",
  description: "BTU-ის AI Skills Digital Passport: სტუდენტის AI კომპეტენციების პერსონალური და გადამოწმებადი ჩანაწერი.",
};

/* Stamp types and the "how the passport grows" steps, worded after page 2 of BTU's passport template. */
const STAMPS = [
  {
    kind: "skill",
    name: "AI Skill",
    format: "Focused learning",
    how: "მიიღება მოკლე ფორმატის აქტივობით: ვორქშოფი, მასტერკლასი, სემინარი, მოწვეული სპიკერის შეხვედრა.",
    means: "კონკრეტული AI კომპეტენციის განვითარება.",
  },
  {
    kind: "applied",
    name: "AI Applied Skill",
    format: "Applied learning",
    how: "მიიღება 2–3 დღიანი პრაქტიკული გამოცდილებით: ინტენსიური ვორქშოფი, ბუტქემპი, ჰაკათონი ან ჩელენჯი.",
    means: "AI კომპეტენციის პრაქტიკაში გამოყენება.",
  },
  {
    kind: "advanced",
    name: "AI Advanced Skill",
    format: "Extended academic learning",
    how: "მიიღება სემესტრული კურსის წარმატებით დასრულებით, სადაც ეს კომპეტენცია სწავლის შედეგების შეფასებული ნაწილია.",
    means: "AI კომპეტენციის ხანგრძლივი და ფორმალურად შეფასებული განვითარება.",
  },
];

const STEPS = [
  { en: "Learn", ka: "ისწავლე კურსზე, ვორქშოფზე ან ჰაკათონზე" },
  { en: "Demonstrate", ka: "აჩვენე უნარი დავალებით ან პროექტით" },
  { en: "Earn", ka: "BTU ადასტურებს უნარს და გაძლევს შტამპს" },
  { en: "Verify", ka: "ყველა ვერსია ბლოკჩეინზე ფიქსირდება" },
  { en: "Build your AI profile", ka: "პასპორტი ახალი შტამპებით იზრდება" },
];

export default async function Home() {
  const student = await getCurrentStudent();
  const open = student ? { href: "/dashboard", label: "ჩემი პასპორტი" } : { href: "/login", label: "შესვლა სტუდენტად" };

  return (
    <>
      <AppHeader area="public" home="/">
        <a className="appbar-link" href="/verify">Verify a passport</a>
        <a className="appbar-link" href={open.href}>{student ? "My passport" : "Student sign-in"}</a>
      </AppHeader>

      <PassportFrame note="პროტოტიპი: ჩანაწერები სატესტო ქსელზეა (Ethereum Sepolia) და გამცემი სატესტოა.">
        {/* The cover of BTU's passport, as a page: white sheet, bold title, orange asterisks, the stickers. */}
        <section className="lp-sheet lp-hero" aria-labelledby="lp-title">
          <div className="lp-hero-text">
            <h1 id="lp-title" className="lp-title">
              <strong>AI Skills</strong> Digital Passport
            </h1>
            <hr className="lp-rule" />
            <p className="lp-lead">
              შენი AI კომპეტენციების პერსონალური და გადამოწმებადი ჩანაწერი, რომელსაც BTU გასცემს და რომელიც სწავლასთან ერთად იზრდება.
            </p>
            <div className="lp-actions">
              <a className="lp-btn lp-btn-primary" href={open.href}>{open.label}</a>
              <a className="lp-btn" href="/verify">პასპორტის გადამოწმება</a>
            </div>
          </div>
          <div className="lp-hero-art">
            <span className="lp-stars" aria-hidden="true">✱<br />✱<br />✱</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/passport-stickers.png"
              width={804}
              height={492}
              alt="პასპორტის სტიკერები: Issued by Business and Technology University, Blockchain verified, Latest AI skillset"
            />
          </div>
        </section>

        <section className="lp-sheet lp-about" aria-labelledby="lp-why">
          <div className="lp-about-head">
            <h2 id="lp-why" className="lp-h2">
              <strong>რას ნიშნავს</strong> AI პასპორტი
            </h2>
            <p className="lp-body">
              დიპლომი ამბობს, რა ისწავლე. AI პასპორტი აჩვენებს, რა <em>შეგიძლია</em>: ყოველი შტამპი არის უნარი, რომელიც BTU-მ
              შეაფასა და დაადასტურა. ის არ ქრება სემესტრის ბოლოს, არამედ გროვდება და ქმნის შენს ინდივიდუალურ AI პროფილს.
            </p>
            <p className="lp-stars-row" aria-hidden="true">✱ ✱ ✱ ✱ ✱ ✱ ✱ ✱</p>
          </div>
          <div className="lp-values">
            <article className="lp-value">
              <p className="lp-who">სტუდენტისთვის</p>
              <h3>დადასტურებული პორტფოლიო</h3>
              <p>ერთი მუდმივი Passport ID, ერთი PDF BTU-ის დიზაინით. გაუზიარე დამსაქმებელს ან სამაგისტრო პროგრამას და ჩამოტვირთე ნებისმიერ დროს.</p>
            </article>
            <article className="lp-value">
              <p className="lp-who">დამსაქმებლისთვის</p>
              <h3>შემოწმება წამებში</h3>
              <p>ვერიფიკაციის კოდით ან PDF-ის ატვირთვით ჩანს, ნამდვილად BTU-მ გასცა თუ არა დოკუმენტი და არის თუ არა ის უახლესი ვერსია.</p>
            </article>
            <article className="lp-value">
              <p className="lp-who">უნივერსიტეტისთვის</p>
              <h3>AI უნარების საერთო ენა</h3>
              <p>ერთიანი სტანდარტი ყველა ფაკულტეტისთვის: კურსები, ვორქშოფები და ჰაკათონები ერთ ჩანაწერში, ათასობით სტუდენტისთვის ყოველწლიურად.</p>
            </article>
          </div>
        </section>

        <section className="lp-sheet" aria-labelledby="lp-stamps">
          <h2 id="lp-stamps" className="lp-h2 lp-h2-orange">Understanding AI Skills Stamps</h2>
          <p className="lp-body lp-narrow">სამი ტიპის შტამპი სწავლის სამ ფორმატს და სიღრმეს აღნიშნავს.</p>
          <div className="lp-stamps">
            {STAMPS.map((s) => (
              <article key={s.kind} className="lp-stamp">
                <span className={`lp-label lp-label-${s.kind}`}>
                  <strong>{s.name}</strong>
                  <span>{s.format}</span>
                </span>
                <p>{s.how}</p>
                <p><b>ნიშნავს:</b> {s.means}</p>
              </article>
            ))}
          </div>
          <div className="lp-important">
            <p className="lp-who">Important</p>
            <p>
              შტამპები არ არის სავალდებულო თანმიმდევრობა: AI Applied ან Advanced Skill-ის მისაღებად AI Skill-ის ქონა არ არის
              საჭირო. მონაწილეობა ნებაყოფლობითია და არ არსებობს შტამპების აუცილებელი რაოდენობა.
            </p>
          </div>
        </section>

        <section className="lp-sheet lp-split" aria-labelledby="lp-grow">
          <div>
            <h2 id="lp-grow" className="lp-h2">
              <strong>How the</strong> passport grows
            </h2>
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s.en}>
                  <span className="lp-step-n">{i + 1}</span>
                  <span>
                    <strong>{s.en}</strong>
                    <span>{s.ka}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h2 className="lp-h2">
              <strong>რატომ</strong> არის სანდო
            </h2>
            <ul className="lp-trust">
              <li><b>მუდმივი Passport ID</b> ყველა სტუდენტს ერთხელ ენიჭება და არასდროს იცვლება.</li>
              <li><b>ვერსიები:</b> ახალი უნარი ქმნის ახალ ვერსიას, ძველი ინახება, უახლესი მოქმედი ვერსია ყოველთვის ცალსახად ჩანს.</li>
              <li><b>ბლოკჩეინი:</b> ყოველი გაცემული ვერსიის ციფრული ანაბეჭდი ბლოკჩეინზე იწერება, ამიტომ შეცვლილი PDF მაშინვე ვლინდება.</li>
              <li><b>BTU, როგორც გამცემი:</b> ჩანაწერს მხოლოდ უნივერსიტეტის გამცემი მისამართი აკეთებს.</li>
              <li><b>საჯარო ვერიფიკაცია</b> კოდით, ანგარიშის გარეშე.</li>
            </ul>
            <a className="lp-btn lp-btn-dark" href="/verify">გადაამოწმე პასპორტი</a>
          </div>
        </section>
      </PassportFrame>
    </>
  );
}
