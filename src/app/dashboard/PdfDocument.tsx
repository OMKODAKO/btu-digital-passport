"use client";

import { useState } from "react";
import PdfViewer from "./PdfViewer";

/** The issued PDF itself, folded under the booklet; its pages are drawn the first time it is opened. */
export default function PdfDocument({ src, title }: { src: string; title: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <details className="pdf-fold" onToggle={(e) => e.currentTarget.open && setOpened(true)}>
      <summary>Show the PDF document</summary>
      <PdfViewer src={src} title={title} active={opened} />
    </details>
  );
}
