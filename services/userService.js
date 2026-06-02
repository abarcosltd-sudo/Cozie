import { AppError } from "../utils/AppError.js";
import { userRepository } from "../repositories/userRepository.js";
import { USER_TYPES } from "../utils/collections.js";

function publicUser(user) {
  if (!user) return null;
  const { password: _pw, otp: _otp, ...rest } = user;
  return rest;
}

/**
 * Read-side default for any user doc written before Artist Bubble shipped.
 * We never want a `undefined` userType reaching the client.
 */
function projectUserType(user) {
  return user?.userType === USER_TYPES.ARTIST ? USER_TYPES.ARTIST : USER_TYPES.USER;
}

/**
 * Strip server-only / sensitive fields from artistProfile before
 * returning it. `bubbleId` is always the user's id, so it's safe to
 * expose and the frontend uses it to deep-link to /bubble/:artistId.
 */
function projectArtistProfile(user) {
  if (!user || projectUserType(user) !== USER_TYPES.ARTIST) return null;
  const ap = user.artistProfile || {};
  return {
    artistName: ap.artistName || user.fullname || user.username || "Artist",
    genres: Array.isArray(ap.genres) ? ap.genres : [],
    label: ap.label || null,
    website: ap.website || null,
    bio: ap.bio || null,
    isVerified: Boolean(ap.isVerified),
    verificationStatus: ap.verificationStatus || "none",
    bubbleId: ap.bubbleId || user.id,
  };
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
      userType: projectUserType(user),
      artistProfile: projectArtistProfile(user),
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
      userType: projectUserType(user),
      artistProfile: projectArtistProfile(user),
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

  /**
   * Artist directory for the Discover → Bubbles tab. Returns artists
   * (excluding the caller if they are one) along with bubble metadata
   * and the caller's membership state for instant Join/View CTAs.
   *
   * Pagination is in-memory page-slicing today because the user count
   * is small and we don't yet have a Firestore index for
   * `where userType == "artist" orderBy createdAt`. Once it matters,
   * swap to a cursor-paginated Firestore query — the response shape
   * is already cursor-compatible.
   *
   * Verification is intentionally NOT a filter — the wireframe shows
   * both verified and unverified artists in the Trending list. The
   * Verified badge on the artist row (driven by `isVerified` in the
   * response) is the visual differentiator. Gating by verification
   * would hide every new artist on the platform, since verification
   * is a separate flow (`verificationStatus: pending → approved`)
   * that most artists won't have completed.
   */
  async listAvailableArtists(currentUserId, { cursor, limit = 20 } = {}) {
    const users = await userRepository.listAll();
    const artists = users.filter(
      (u) =>
        projectUserType(u) === USER_TYPES.ARTIST &&
        u.id !== currentUserId
    );
    artists.sort((a, b) => {
      const aTs = a.createdAt?.toDate?.()?.getTime?.() ?? new Date(a.createdAt || 0).getTime();
      const bTs = b.createdAt?.toDate?.()?.getTime?.() ?? new Date(b.createdAt || 0).getTime();
      return bTs - aTs;
    });

    const startIdx = cursor
      ? artists.findIndex((a) => a.id === cursor) + 1
      : 0;
    const page = artists.slice(startIdx, startIdx + limit);
    const nextCursor =
      startIdx + limit < artists.length ? page[page.length - 1]?.id || null : null;

    // Hydrate caller's membership for each bubble in one round-trip.
    const { bubbleRepository } = await import(
      "../repositories/bubbleRepository.js"
    );
    const bubbleIds = page.map((u) => u.id);
    const [bubbleSnaps, memberships] = await Promise.all([
      bubbleIds.length > 0
        ? Promise.all(bubbleIds.map((id) => bubbleRepository.findById(id)))
        : Promise.resolve([]),
      bubbleRepository.getMembershipStatuses(bubbleIds, currentUserId),
    ]);

    const items = page.map((u, i) => {
      const bubble = bubbleSnaps[i];
      const ap = projectArtistProfile(u) || {};
      return {
        id: u.id,
        artistName: ap.artistName,
        displayName: u.fullname || u.displayName || u.username || ap.artistName,
        username: u.username || "",
        photoURL: u.photoURL || null,
        isVerified: Boolean(ap.isVerified),
        genres: ap.genres || [],
        bubble: bubble
          ? {
              id: bubble.id,
              memberCount: bubble.memberCount || 0,
              isOpen: bubble.isOpen !== false,
              userIsMember: Boolean(memberships.get(bubble.id)),
            }
          : null,
      };
    });

    return { artists: items, nextCursor, count: items.length };
  },
};
