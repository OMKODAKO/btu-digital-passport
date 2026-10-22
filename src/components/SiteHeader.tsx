// BTU-style frame: dark utility bar, white navigation bar, and the BTU mark in a grey block that
// overhangs both (as on btu.edu.ge).
export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-top">
        <div className="site-inner">
          <nav className="site-util" aria-label="Utility">
            <a href="/verify">Verify</a>
            <a href="/login">Students</a>
            <a href="/admin/login">Staff</a>
          </nav>
          <a className="site-cta" href="/verify">
            Check a passport
          </a>
        </div>
      </div>
      <div className="site-nav">
        <div className="site-inner">
          <a className="site-logo" href="/" aria-label="BTU AI Skills Digital Passport, home">
            <span className="site-logo-text">BTU</span>
            <svg viewBox="0 0 60 44" aria-hidden="true">
              {[0, 7, 14, 21].map((d) => (
                <path key={d} d={`M${4 + d / 2} ${4 + d} L30 ${18 + d} L${56 - d / 2} ${4 + d}`} />
              ))}
            </svg>
          </a>
          <nav className="site-main" aria-label="Main">
            <a href="/dashboard">My passport</a>
            <a href="/verify">Verification</a>
            <a href="/admin">Administration</a>
          </nav>
        </div>
      </div>
    </header>
  );
}
