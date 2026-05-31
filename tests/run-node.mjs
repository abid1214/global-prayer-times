// Headless entry point: `npm test` -> `node tests/run-node.mjs`.
// Installs the browser-global shims, then imports the test module, which runs
// its assertions at import time and (when document is absent) prints a summary
// to stdout and sets process.exitCode on failure. The same test module still
// renders to the page when opened via tests/classifierAgreement.html.
import "./node-shim.js";
import "./shaderConstants.test.mjs";
import "./classifierAgreement.test.js";
