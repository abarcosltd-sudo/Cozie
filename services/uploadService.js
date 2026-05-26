import { v4 as uuidv4 } from "uuid";
import { requireFrontendBucket } from "../config/firebase.js";
import { AppError } from "../utils/AppError.js";

const SIGNED_URL_TTL_MS = 30 * 60 * 1000;

function sanitiseFileName(name) {
  return name.replace(/[^a-zA-Z0-9.]/g, "_");
}

function buildBlobPath(prefix, ownerId, fileName) {
  const safeName = sanitiseFileName(fileName);
  const stamp = Date.now();
  const shortId = uuidv4().split("-")[0];
  return `${prefix}/${ownerId}/${stamp}_${shortId}_${safeName}`;
}

async function createSignedUrl(prefix, { ownerId, fileName, fileType, ttlMs }) {
  const bucket = requireFrontendBucket();
  const blobPath = buildBlobPath(prefix, ownerId, fileName);
  const file = bucket.file(blobPath);
  const [signedUrl] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + (ttlMs ?? SIGNED_URL_TTL_MS),
    contentType: fileType,
  });
  return {
    signedUrl,
    publicUrl: `https://storage.googleapis.com/${bucket.name}/${blobPath}`,
    path: blobPath,
  };
}

export const uploadService = {
  async createProfilePhotoUploadUrl({ userId, fileName, fileType }) {
    return createSignedUrl("profile-photos", {
      ownerId: userId,
      fileName,
      fileType,
      ttlMs: 15 * 60 * 1000,
    });
  },

  async createAudioUploadUrl({ userId, fileName, fileType }) {
    if (!fileType.startsWith("audio/")) {
      throw AppError.badRequest("Only audio files are allowed");
    }
    return createSignedUrl("music", { ownerId: userId, fileName, fileType });
  },

  async createAlbumArtUploadUrl({ userId, fileName, fileType }) {
    if (!fileType.startsWith("image/")) {
      throw AppError.badRequest("Only image files are allowed for album art");
    }
    return createSignedUrl("album-art", {
      ownerId: userId,
      fileName,
      fileType,
    });
  },
};
