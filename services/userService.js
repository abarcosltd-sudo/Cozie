import { AppError } from "../utils/AppError.js";
import { userRepository } from "../repositories/userRepository.js";

function publicUser(user) {
  if (!user) return null;
  const { password: _pw, otp: _otp, ...rest } = user;
  return rest;
}

export const userService = {
  async getProfile(userId) {
    const user = await userRepository.findById(userId);
    if (!user) throw AppError.notFound("User not found");
    return {
      id: user.id,
      fullname: user.fullname,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      bio: user.bio,
      followerCount: user.followerCount || 0,
      followingCount: user.followingCount || 0,
      visibility: user.visibility || "public",
    };
  },

  async getCurrentUser(userId) {
    const user = await userRepository.findById(userId);
    if (!user) throw AppError.notFound("User not found");
    const safe = publicUser(user);
    return {
      ...safe,
      followerCount: safe.followerCount || 0,
      followingCount: safe.followingCount || 0,
      visibility: safe.visibility || "public",
      unreadNotificationCount: safe.unreadNotificationCount || 0,
    };
  },

  async savePreferences(userId, genres) {
    const user = await userRepository.findById(userId);
    if (!user) throw AppError.notFound("User not found");
    await userRepository.update(userId, { genres });
  },

  async updateProfile(userId, { displayName, username, bio, photoURL, removePhoto }) {
    const user = await userRepository.findById(userId);
    if (!user) throw AppError.notFound("User not found");

    const updates = {};
    if (displayName !== undefined) updates.displayName = displayName;
    if (bio !== undefined) updates.bio = bio;

    if (username !== undefined) {
      const existing = await userRepository.findByUsername(username);
      if (existing && existing.id !== userId) {
        throw AppError.badRequest("Username already taken");
      }
      updates.username = username;
    }

    if (removePhoto === true) {
      updates.photoURL = null;
    } else if (photoURL !== undefined) {
      updates.photoURL = photoURL;
    }

    if (Object.keys(updates).length === 0) {
      throw AppError.badRequest("No fields provided to update");
    }

    await userRepository.update(userId, updates);
  },

  async listAvailable(currentUserId) {
    const users = await userRepository.listAll();
    return users
      .filter((u) => u.id !== currentUserId)
      .map((u) => ({
        id: u.id,
        name: u.fullname || u.displayName || u.username || "User",
        username: u.username || "",
        email: u.email || "",
        photoURL: u.photoURL || null,
        isOnline: u.isOnline || false,
      }));
  },
};
