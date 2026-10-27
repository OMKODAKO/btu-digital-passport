import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BTU AI Skills Digital Passport",
  description: "View and download your BTU AI Skills Digital Passport.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Heading/body fonts; without a connection the pages fall back to system fonts and still work. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600&family=Outfit:wght@300;400;600;800;900&family=Inter:wght@400;500;600;700&family=Noto+Sans+Georgian:wght@400;600&family=EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IM+Fell+English+SC&family=Special+Elite&family=Noto+Serif+Georgian:wght@400;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
