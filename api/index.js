/**
 * Vercel serverless entrypoint.
 *
 * Vercel's api/ filesystem routing turns this file into a function — every
 * request rewritten here gets handed to our default export, which is the
 * existing Express app. The app itself lives in ../server.js so local /
 * Docker / node server.js workflows are unchanged.
 *
 * Routing into this function is set up in ../vercel.json (rewrites pin all
 * URLs at /api).
 */
export { default } from "../server.js";
