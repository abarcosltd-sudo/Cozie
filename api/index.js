/**
 * Vercel serverless entrypoint.
 *
 * Vercel's api/ filesystem routing turns this file into a function — every
 * request rewritten here is handed to our default export, the existing
 * Express app (mounted in ../server.js). Local / Docker / node server.js
 * workflows are unchanged.
 *
 * The dynamic import + try/catch is deliberate: if any downstream module has
 * a syntax error or a config-time crash (Firebase env, etc.), Node's native
 * error message — including the offending file path and line — will land in
 * Vercel's runtime logs. The function then degrades to a 500 responder so
 * health-checking platforms aren't misled by silent crashes.
 */

let app;
let bootError = null;

try {
  const mod = await import("../server.js");
  app = mod.default;
  if (typeof app !== "function") {
    throw new Error(
      Loaded ../server.js but default export is ${typeof app}, expected function
    );
  }
} catch (err) {
  bootError = err;
  // Log loudly so the message + file path show up in Vercel's runtime logs.
  console.error("[api/index] Failed to load server.js. Underlying error:");
  console.error(err);
  if (err?.stack) console.error(err.stack);

  app = (req, res) => {
    res.status(500).json({
      success: false,
      error: "Backend boot failed",
      message: bootError?.message || String(bootError),
    });
  };
}

export default app;
