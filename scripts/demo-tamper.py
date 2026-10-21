"""Demo step 14: makes a modified copy of a passport PDF, the way a forger would: it adds a line of text
to the cover and saves a new file. The copy still opens normally but must fail verification.

usage: python3 scripts/demo-tamper.py <passport.pdf> <modified.pdf>"""
import sys

import pymupdf

src, out = sys.argv[1:3]
doc = pymupdf.open(src)
doc[0].insert_text((60, 120), "AI Data Analysis - Expert", fontsize=12)
doc.save(out)
print(f"wrote {out}: same document with one extra line of text on the cover")
