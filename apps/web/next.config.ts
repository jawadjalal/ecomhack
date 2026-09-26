import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        // Dashboards with no site picked open on the demo store's (the one at /store) instead of an empty page.
        // Onboarding and every other link pass ?site= explicitly; the page's site box still switches.
        source: "/console/dashboards",
        missing: [{ type: "query", key: "site" }],
        destination: "/console/dashboards?site=pace-store",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
