import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BTU AI Skills Digital Passport",
  description: "View and download your BTU AI Skills Digital Passport.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
