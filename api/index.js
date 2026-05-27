/**
 * Vercel serverless entrypoint.
 *
 * Intentionally minimal and synchronous at module load — no top-level await,
 * no top-level imports of our app code. We lazy-load ../server.js on the
 * very first request and cache the result for the lifetime of the container.
 *
 * Reason: Vercel's @vercel/node wrapping has historically interacted badly
 * with top-level await on some Node patch versions. Loading lazily inside
 * the request handler means any module-resolution / parse error is caught,
 * logged with a full stack (so Vercel's runtime logs name the offending
 * file:line:col), and surfaced to the client as a JSON 500 — instead of
 * crashing the function with a stack we can't read.
 *
 * Local / Docker / node server.js keeps using server.js directly.
 */

let cachedApp = null;
let bootError = null;

async function loadApp() {
  if (cachedApp) return cachedApp;
  if (bootError) return null;
  try {
    const mod = await import("../server.js");
    if (typeof mod.default !== "function") {
      throw new Error(
        `Expected default export of server.js to be a function, got ${typeof mod.default}`
      );
    }
    cachedApp = mod.default;
    return cachedApp;
  } catch (err) {
    bootError = err;
    // Log loudly so Vercel runtime logs surface the underlying file:line.
    console.error("[api/index] Failed to load ../server.js");
    console.error(err);
    if (err && err.stack) console.error(err.stack);
    return null;
  }
}

export default async function handler(req, res) {
  const app = await loadApp();
  if (!app) {
    res.status(500).json({
      success: false,
      error: "Backend boot failed",
      message: (bootError && bootError.message) || String(bootError),
      // Stack helps debugging on staging; strip in prod hardening later.
      stack: (bootError && bootError.stack) || null,
    });
    return;
  }
  return app(req, res);
}
