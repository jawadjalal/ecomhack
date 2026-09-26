import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This folder is meant to be copied into its own repo; pin the root so Next doesn't pick up a parent lockfile.
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  // The storefront reads storefront.config.json at request time, so a merged Darwin PR shows up without a rebuild.
  outputFileTracingIncludes: { "/**": ["./storefront.config.json"] },
};

export default nextConfig;
