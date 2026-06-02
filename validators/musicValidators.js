import { z } from "zod";

export const addMusicSchema = z.object({
  fileUrl: z.string().url(),
  albumArtUrl: z.string().url().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().min(1).max(200),
  featuredArtists: z.string().max(500).optional().default(""),
  // Singles (no album) are first-class on Cozie — especially for bubble
  // drops — so this is optional. Empty string is the canonical "no album"
  // value, matching the rest of the optional metadata fields below.
  album: z.string().trim().max(200).optional().default(""),
  genre: z.string().max(100).nullable().optional(),
  subgenre: z.string().max(100).optional().default(""),
  mood: z.string().max(100).optional().default(""),
  producer: z.string().max(200).optional().default(""),
  songwriter: z.string().max(200).optional().default(""),
  composer: z.string().max(200).optional().default(""),
  recordLabel: z.string().max(200).optional().default(""),
  releaseDate: z.string().max(50).optional().default(""),
  releaseYear: z.string().max(10).optional().default(""),
  country: z.string().max(100).optional().default(""),
  language: z.string().max(100).optional().default(""),
  duration: z.union([z.string(), z.number()]).optional().default(""),
  bpm: z.union([z.string(), z.number()]).optional().default(""),
  musicalKey: z.string().max(20).optional().default(""),
  isrc: z.string().max(50).optional().default(""),
  explicit: z.union([z.string(), z.boolean()]).optional().default(""),
  copyright: z.string().max(500).optional().default(""),
  publishingRights: z.string().max(500).optional().default(""),
  originalWork: z.boolean().optional().default(false),
  description: z.string().max(2000).optional().default(""),
  lyrics: z.string().max(20000).optional().default(""),
  tags: z.string().max(500).optional().default(""),
});

export const searchMusicQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
});

export const songIdParamSchema = z.object({
  songId: z.string().min(1),
});
