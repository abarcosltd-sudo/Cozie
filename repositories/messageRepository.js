import { db } from "../config/firebase.js";
import { COLLECTIONS, SUBCOLLECTIONS } from "../utils/collections.js";
import { userRepository } from "./userRepository.js";

const conversationsCol = () => db().collection(COLLECTIONS.CONVERSATIONS);

export const messageRepository = {
  conversationRef(id) {
    return conversationsCol().doc(id);
  },

  messagesCol(conversationId) {
    return conversationsCol()
      .doc(conversationId)
      .collection(SUBCOLLECTIONS.MESSAGES);
  },

  async findConversationById(conversationId) {
    const doc = await conversationsCol().doc(conversationId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async findConversationBetween(userIdA, userIdB) {
    const snap = await conversationsCol()
      .where("participants", "array-contains", userIdA)
      .get();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (Array.isArray(data.participants) && data.participants.includes(userIdB)) {
        return { id: doc.id, ...data };
      }
    }
    return null;
  },

  /**
   * Atomically get-or-create the conversation between two users.
   * Uses a deterministic doc ID (sorted participant pair) so two concurrent
   * "first message" requests can't end up creating duplicate conversations.
   */
  async getOrCreateConversation(userIdA, userIdB) {
    const id = [userIdA, userIdB].sort().join("__");
    const ref = conversationsCol().doc(id);
    const now = new Date();
    await ref.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return;
      tx.set(ref, {
        participants: [userIdA, userIdB].sort(),
        createdAt: now,
        lastMessage: "",
        lastMessageTime: now,
        updatedAt: now,
      });
    });
    return { id };
  },

  async updateConversationLastMessage(conversationId, payload) {
    await conversationsCol().doc(conversationId).update({
      ...payload,
      updatedAt: new Date(),
    });
  },

  async listMessages(conversationId, limit = 100) {
    const snap = await this.messagesCol(conversationId)
      .orderBy("timestamp", "asc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async listUnreadForUser(conversationId, userId) {
    const snap = await this.messagesCol(conversationId)
      .where("receiverId", "==", userId)
      .where("read", "==", false)
      .get();
    return snap.docs;
  },

  async createMessage(conversationId, messageData) {
    const ref = await this.messagesCol(conversationId).add(messageData);
    return { id: ref.id };
  },

  messageRef(conversationId, messageId) {
    return this.messagesCol(conversationId).doc(messageId);
  },

  userConversationRef(userId, conversationId) {
    return userRepository.conversationsCol(userId).doc(conversationId);
  },

  async listUserConversations(userId, limit = 50) {
    const snap = await userRepository
      .conversationsCol(userId)
      .orderBy("lastMessageTime", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async upsertUserConversation(userId, conversationId, data) {
    await this.userConversationRef(userId, conversationId).set(data, {
      merge: true,
    });
  },

  async getUserConversation(userId, conversationId) {
    const doc = await this.userConversationRef(userId, conversationId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  async resetUnread(userId, conversationId) {
    await this.userConversationRef(userId, conversationId)
      .update({ unreadCount: 0 })
      .catch(() => {});
  },
};
