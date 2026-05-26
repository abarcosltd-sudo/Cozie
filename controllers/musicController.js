import { asyncHandler } from "../utils/asyncHandler.js";
import { ok, created } from "../utils/response.js";
import { musicService } from "../services/musicService.js";
import { uploadService } from "../services/uploadService.js";

export const generateUploadURL = asyncHandler(async (req, res) => {
  const result = await uploadService.createAudioUploadUrl({
    userId: req.auth.id,
    fileName: req.body.fileName,
    fileType: req.body.fileType,
  });
  return ok(res, result);
});

export const generateAlbumArtURL = asyncHandler(async (req, res) => {
  const result = await uploadService.createAlbumArtUploadUrl({
    userId: req.auth.id,
    fileName: req.body.fileName,
    fileType: req.body.fileType,
  });
  return ok(res, result);
});

export const addMusic = asyncHandler(async (req, res) => {
  const result = await musicService.addMusic(req.auth.id, req.body);
  return created(res, { message: "Music added successfully", ...result });
});

export const searchMusic = asyncHandler(async (req, res) => {
  const q = req.validatedQuery?.q ?? req.query?.q;
  const result = await musicService.search(q);
  return ok(res, result);
});

export const getTrendingMusic = asyncHandler(async (_req, res) => {
  const result = await musicService.listTrending();
  return ok(res, result);
});

export const getTopCharts = asyncHandler(async (_req, res) => {
  const result = await musicService.listTopCharts();
  return ok(res, result);
});

export const getSongById = asyncHandler(async (req, res) => {
  const result = await musicService.getSong(req.params.songId);
  return ok(res, result);
});
