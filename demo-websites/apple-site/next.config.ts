import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The storefront reads its PageSpec from disk on every request (so a merged Darwin PR, or an edited
  // file, shows on the next refresh). Make sure the files ship with serverless/standalone builds too.
  outputFileTracingIncludes: {
    "/**": ["./storefront.config.json", "./presets/*.json"],
  },
};

export default nextConfig;
