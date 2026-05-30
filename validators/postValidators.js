import { z } from "zod";

/**
 * Share-music post body.
 *
 * `platforms` is purely audit metadata — the field is persisted on the
 * post doc but nothing downstream reads it (see PROGRESS.md item "Share
 * post to other platforms (platforms array is recorded but not acted
 * on)"). It used to come from a per-platform checkbox UI on the legacy
 * `Pages/ShareMusic.tsx`; the modern `src/pages/ShareMusic.tsx` removed
 * that picker, so the field is allowed to be absent and defaults to
 * an empty array. Both the legacy and the modern client are accepted.
 *
 * If/when an outbound share fan-out is built, tighten this back to
 * require at least one platform AND update the modern UI accordingly.
 */
export const shareMusicSchema = z.object({
  songId: z.string().min(1),
  caption: z.string().max(2000).optional().default(""),
  platforms: z
    .array(z.string().min(1).max(64))
    .max(10)
    .optional()
    .default([]),
});

export const postIdParamSchema = z.object({
  postId: z.string().min(1),
});

export const addCommentSchema = z.object({
  text: z.string().trim().min(1).max(1000),
});
