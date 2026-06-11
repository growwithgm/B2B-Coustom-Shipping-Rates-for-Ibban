// Entry point — the Shopify CLI detects a JavaScript function by this file
// (src/index.js) and bundles it with ESBuild before compiling to Wasm with
// Javy. Each [[extensions.targeting]] export in shopify.extension.toml must
// be re-exported here.
export { run } from "./run.js";
