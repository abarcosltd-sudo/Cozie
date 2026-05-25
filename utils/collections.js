export const COLLECTIONS = Object.freeze({
  USERS: "users",
  MUSIC: "music",
  MUSIC_POSTS: "musicPosts",
  CONVERSATIONS: "conversations",
});

export const SUBCOLLECTIONS = Object.freeze({
  LIKES: "likes",
  COMMENTS: "comments",
  MESSAGES: "messages",
  FAVORITES: "favorites",
  LIKED_SONGS: "likedSongs",
  USER_CONVERSATIONS: "conversations",
  FOLLOWERS: "followers",
  FOLLOWING: "following",
  NOTIFICATIONS: "notifications",
});

/**
 * Canonical notification event types. Keep in sync with the union in
 * `validators/notificationValidators.js` and the emit helpers in
 * `services/notificationService.js`.
 */
export const NOTIFICATION_TYPES = Object.freeze({
  FOLLOW: "follow",
  POST_LIKE: "post_like",
  POST_COMMENT: "post_comment",
  SONG_LIKE: "song_like",
});
