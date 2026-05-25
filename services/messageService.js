import { AppError } from "../utils/AppError.js";
import { db } from "../config/firebase.js";
import { messageRepository } from "../repositories/messageRepository.js";
import { userRepository } from "../repositories/userRepository.js";

const GRADIENTS = [
  "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
  "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)",
  "linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)",
  "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)",
  "linear-gradient(135deg, #10b981 0%, #06b6d4 100%)",
];

function randomGradient() {
  return GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)];
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.seconds === "number")
    return new Date(value.seconds * 1000).toISOString();
  if (typeof value === "string") return value;
  return new Date(value).toISOString();
}

function displayName(user) {
  if (!user) return "User";
  return user.fullname || user.displayName || user.username || "User";
}

async function getOrCreateConversation(userIdA, userIdB) {
  // Deterministic ID + transaction guarantees uniqueness even under races.
  const { id } = await messageRepository.getOrCreateConversation(
    userIdA,
    userIdB
  );
  return id;
}

async function upsertParticipantSummary({
  ownerId,
  conversationId,
  otherUserId,
  messageData,
  incrementUnread,
}) {
  const otherUser = await userRepository.findById(otherUserId);
  const lastMessageText =
    messageData.text || (messageData.isMusic ? "🎵 Shared a song" : "");

  let unreadCount = 0;
  if (incrementUnread && messageData.senderId !== ownerId) {
    const existing = await messageRepository.getUserConversation(
      ownerId,
      conversationId
    );
    unreadCount = (existing?.unreadCount || 0) + 1;
  }

  await messageRepository.upsertUserConversation(ownerId, conversationId, {
    conversationId,
    otherUserId,
    otherUserName: displayName(otherUser),
    otherUserAvatar: otherUser?.photoURL || null,
    otherUserOnline: otherUser?.isOnline || false,
    lastMessage: lastMessageText,
    lastMessageTime: messageData.timestamp,
    lastMessageSenderId: messageData.senderId,
    unreadCount,
  });
}

export const messageService = {
  async listConversations(userId) {
    const conversations = await messageRepository.listUserConversations(userId);
    return {
      conversations: conversations
        .filter((c) => c.otherUserId)
        .map((c) => ({
          id: c.id,
          otherUserId: c.otherUserId,
          name: c.otherUserName || "User",
          avatar: c.otherUserAvatar || null,
          avatarGradient: randomGradient(),
          lastMessage: c.lastMessage || "",
          lastMessageTime: toIso(c.lastMessageTime),
          unreadCount: c.unreadCount || 0,
          isOnline: c.otherUserOnline || false,
        })),
    };
  },

  async listMessages(conversationId, userId) {
    const conversation = await messageRepository.findConversationById(
      conversationId
    );
    if (!conversation) throw AppError.notFound("Conversation not found");

    if (!(conversation.participants || []).includes(userId)) {
      throw AppError.forbidden("You do not have access to this conversation");
    }

    const messages = await messageRepository.listMessages(conversationId);
    const formatted = messages.map((m) => ({
      id: m.id,
      text: m.text || "",
      senderId: m.senderId,
      receiverId: m.receiverId,
      timestamp: toIso(m.timestamp),
      isMusic: m.isMusic || false,
      musicTitle: m.musicTitle || null,
      musicArtist: m.musicArtist || null,
      musicUrl: m.musicUrl || null,
      read: m.read || false,
    }));

    const unread = await messageRepository.listUnreadForUser(
      conversationId,
      userId
    );
    // Firestore caps writes-per-batch at 500. Chunk to be safe for heavy
    // backlogs (e.g. user returning after a long absence).
    const BATCH_LIMIT = 450;
    for (let i = 0; i < unread.length; i += BATCH_LIMIT) {
      const slice = unread.slice(i, i + BATCH_LIMIT);
      const batch = db().batch();
      for (const doc of slice) batch.update(doc.ref, { read: true });
      await batch.commit();
    }

    await messageRepository.resetUnread(userId, conversationId);

    return { messages: formatted, conversationId };
  },

  async sendMessage({ senderId, recipientId, text, isMusic, musicTitle, musicArtist, musicUrl }) {
    const recipient = await userRepository.findById(recipientId);
    if (!recipient) throw AppError.notFound("User not found");

    const conversationId = await getOrCreateConversation(senderId, recipientId);
    const timestamp = new Date();

    const messageData = {
      senderId,
      receiverId: recipientId,
      text: text || "",
      isMusic: isMusic || false,
      musicTitle: musicTitle || null,
      musicArtist: musicArtist || null,
      musicUrl: musicUrl || null,
      timestamp,
      read: false,
    };

    const { id: messageId } = await messageRepository.createMessage(
      conversationId,
      messageData
    );

    const lastMessageText =
      text || (isMusic ? `🎵 Shared: ${musicTitle} by ${musicArtist}` : "");

    await messageRepository.updateConversationLastMessage(conversationId, {
      lastMessage: lastMessageText,
      lastMessageTime: timestamp,
      lastMessageSenderId: senderId,
    });

    await upsertParticipantSummary({
      ownerId: senderId,
      conversationId,
      otherUserId: recipientId,
      messageData,
      incrementUnread: false,
    });
    await upsertParticipantSummary({
      ownerId: recipientId,
      conversationId,
      otherUserId: senderId,
      messageData,
      incrementUnread: true,
    });

    return {
      messageId,
      conversationId,
      message: { id: messageId, ...messageData, timestamp: timestamp.toISOString() },
    };
  },

  async deleteMessage({ conversationId, messageId, userId }) {
    const ref = messageRepository.messageRef(conversationId, messageId);
    const doc = await ref.get();
    if (!doc.exists) throw AppError.notFound("Message not found");

    const data = doc.data();
    if (data.senderId !== userId) {
      throw AppError.forbidden("You can only delete your own messages");
    }

    await ref.delete();
    return { message: "Message deleted successfully" };
  },
};
