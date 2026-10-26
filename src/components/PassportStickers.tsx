/**
 * The five stickers from the cover of BTU's passport template, drawn as one SVG so that every sticker is whole
 * (the old PNG was cut from the template and clipped at its edges). Each sticker sits in its own group: it is
 * stamped onto the page one after another, and lifts a little under the pointer.
 */
export default function PassportStickers({ className, label }: { className?: string; label?: string }) {
  const asterisk = [0, 45, 90, 135].map((a) => (
    <line key={a} x1="0" y1="-30" x2="0" y2="30" transform={`rotate(${a})`} />
  ));
  return (
    <svg
      className={`pp-stickers${className ? ` ${className}` : ""}`}
      viewBox="0 0 560 440"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <path id="pp-ring" d="M 0,-72 a 72,72 0 1,1 0,144 a 72,72 0 1,1 0,-144" />
      </defs>

      <g className="pp-sticker" style={{ ["--i" as string]: 0, ["--r" as string]: "5deg" }} transform="translate(350 72)">
        <g className="pp-sticker-body">
          <rect x="-160" y="-50" width="320" height="100" rx="3" fill="#f47b2a" />
          <rect x="-150" y="-40" width="300" height="80" rx="2" fill="none" stroke="#141414" strokeWidth="3" />
          <text className="pp-sticker-text" textAnchor="middle" fontSize="20" y="-6">ISSUED BY BUSINESS AND</text>
          <text className="pp-sticker-text" textAnchor="middle" fontSize="20" y="20">TECHNOLOGY UNIVERSITY</text>
        </g>
      </g>

      <g className="pp-sticker" style={{ ["--i" as string]: 1, ["--r" as string]: "-6deg" }} transform="translate(196 386)">
        <g className="pp-sticker-body">
          <rect x="-158" y="-34" width="316" height="68" rx="3" fill="#ec3f8f" />
          <rect x="-150" y="-26" width="300" height="52" rx="6" fill="none" stroke="#fff" strokeWidth="3" />
          <text className="pp-sticker-text" textAnchor="middle" fontSize="25" y="9" fill="#fff">LATEST AI SKILLSET</text>
        </g>
      </g>

      <g className="pp-sticker" style={{ ["--i" as string]: 2, ["--r" as string]: "-8deg" }} transform="translate(112 150)">
        <g className="pp-sticker-body">
          <circle r="98" fill="#79ee8f" />
          <circle r="54" fill="none" stroke="#141414" strokeWidth="3" />
          <text className="pp-sticker-text pp-sticker-ring" fontSize="15">
            <textPath href="#pp-ring" textLength="446" lengthAdjust="spacing">
              SKILLS IN AI ✱ INTERNATIONALLY RECOGNISED ✱
            </textPath>
          </text>
          <g className="pp-sticker-asterisk" stroke="#141414" strokeWidth="13" strokeLinecap="round">{asterisk}</g>
        </g>
      </g>

      <g className="pp-sticker" style={{ ["--i" as string]: 3, ["--r" as string]: "-10deg" }} transform="translate(440 218)">
        <g className="pp-sticker-body">
          <rect x="-108" y="-54" width="216" height="108" rx="4" fill="#b83ea6" />
          <rect x="-98" y="-44" width="196" height="88" rx="2" fill="none" stroke="#fff" strokeWidth="2.5" strokeDasharray="7 6" />
          <text className="pp-sticker-text" textAnchor="middle" fontSize="25" y="-4" fill="#fff">BLOCKCHAIN</text>
          <text className="pp-sticker-text" textAnchor="middle" fontSize="25" y="26" fill="#fff">VERIFIED</text>
        </g>
      </g>

      <g className="pp-sticker" style={{ ["--i" as string]: 4, ["--r" as string]: "0deg" }} transform="translate(300 252)">
        <g className="pp-sticker-body">
          <polygon points="0,-112 136,94 -136,94" fill="#66d4f6" strokeLinejoin="round" />
          <polyline points="-40,-30 0,-90 40,-30" fill="none" stroke="#141414" strokeWidth="3" />
          <polyline points="-30,-30 0,-76 30,-30" fill="none" stroke="#141414" strokeWidth="3" />
          <text className="pp-sticker-text" textAnchor="middle" fontSize="21" y="12">AI</text>
          <text className="pp-sticker-text" textAnchor="middle" fontSize="21" y="38">SKILLS</text>
          <text className="pp-sticker-text" textAnchor="middle" fontSize="21" y="66">DIGITAL PASSPORT</text>
        </g>
      </g>
    </svg>
  );
}
