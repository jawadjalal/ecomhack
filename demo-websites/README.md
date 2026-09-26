# Demo websites

Standalone storefronts for demoing Darwin on stores it did not build. Each folder is its own app (own `package.json`), reads a Darwin PageSpec from its `storefront.config.json`, and loads `darwin.js`. Copy a folder into its own repo to connect it to Darwin.

- `fleek-site/`: Rackd, a Fleek-style wholesale-vintage store (port 3002). See its README.
- `apple-site/`: Orchard, a big-tile consumer-electronics store (port 3001; local-only exact mirror mode on 3011). See its README.
