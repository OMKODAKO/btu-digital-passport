import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module and must stay outside the server bundle.
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Pages may not be framed by any site. The PDF route sets its own
        // headers so the dashboard (same origin) can embed it.
        source: "/((?!api/passport/pdf).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
