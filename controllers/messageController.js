import { db } from '../config/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import Cors from 'cors';
import jwt from 'jsonwebtoken';

// Helper to run CORS middleware
function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

// CORS configuration
const cors = Cors({
  origin: function (origin, callback) {
    if (!origin || origin.includes("vercel.app") || origin.includes("localhost")) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "DELETE", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

// JWT secret from environment
const JWT_SECRET = process.env.JWT_SECRET;

//=====================================================
// Middleware to verify JWT and attach user to request
//=====================================================
async function authenticate(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ success: false, message: "No token provided" });
    return null;
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return req.user;
  } catch (error) {
    res.status(401).json({ success: false, message: "Invalid or expired token" });
    return null;
  }
}

//=============================================
// GET /api/conversations
// Get all conversations for current user
//=============================================
export const getConversations = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  try {
    const conversationsRef = db
      .collection('users')
      .doc(user.id)
      .collection('conversations');
    
    const conversationsSnapshot = await conversationsRef
      .orderBy('lastMessageTime', 'desc')
      .get();

    const conversations = [];
    for (const doc of conversationsSnapshot.docs) {
      const convData = doc.data();
      
      // Get other user info
      const otherUserDoc = await db.collection('users').doc(convData.otherUserId).get();
      const otherUserData = otherUserDoc.exists ? otherUserDoc.data() : null;
      
      conversations.push({
        id: doc.id,
        otherUserId: convData.otherUserId,
        name: otherUserData?.fullname || otherUserData?.displayName || otherUserData?.username || 'User',
        avatar: otherUserData?.photoURL || null,
        avatarGradient: getRandomGradient(),
        lastMessage: convData.lastMessage || '',
        lastMessageTime: convData.lastMessageTime?.toDate()?.toISOString() || new Date().toISOString(),
        unreadCount: convData.unreadCount || 0,
        isOnline: otherUserData?.isOnline || false
      });
    }

    return res.status(200).json({
      success: true,
      conversations
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

//================================================
// GET /api/messages/:conversationId
// Get messages for a specific conversation
//================================================
export const getMessages = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  const { conversationId } = req.params;

  try {
    const messagesSnapshot = await db
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .orderBy('timestamp', 'asc')
      .get();

    const messages = messagesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate()?.toISOString()
    }));

    // Mark messages as read
    await db
      .collection('users')
      .doc(user.id)
      .collection('conversations')
      .doc(conversationId)
      .update({
        unreadCount: 0
      });

    return res.status(200).json({
      success: true,
      messages
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

//===================================================================
// POST /api/messages/:userId
// Send a message to another user (creates conversation if needed)
//===================================================================
export const sendMessage = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  const { userId } = req.params;
  const { text, isMusic, musicTitle, musicArtist, musicUrl } = req.body;

  try {
    if (!text && !isMusic) {
      return res.status(400).json({ success: false, message: 'Message text or music is required' });
    }

    // Check if other user exists
    const otherUserDoc = await db.collection('users').doc(userId).get();
    if (!otherUserDoc.exists) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Find or create conversation
    let conversationId = await getOrCreateConversation(user.id, userId);
    
    // Create message
    const messageData = {
      senderId: user.id,
      receiverId: userId,
      text: text || '',
      isMusic: isMusic || false,
      musicTitle: musicTitle || null,
      musicArtist: musicArtist || null,
      musicUrl: musicUrl || null,
      timestamp: new Date(),
      read: false
    };

    const messageRef = await db
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .add(messageData);

    // Update conversation last message info
    await db
      .collection('conversations')
      .doc(conversationId)
      .update({
        lastMessage: text || `🎵 Shared: ${musicTitle} by ${musicArtist}`,
        lastMessageTime: new Date(),
        lastMessageSenderId: user.id
      });

    // Update user's conversation list
    await updateUserConversation(user.id, conversationId, userId, messageData);
    await updateUserConversation(userId, conversationId, user.id, messageData, true);

    return res.status(201).json({
      success: true,
      messageId: messageRef.id,
      conversationId,
      message: {
        id: messageRef.id,
        ...messageData,
        timestamp: messageData.timestamp.toISOString()
      }
    });
  } catch (error) {
    console.error('Error sending message:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

//==========================================================
// Helper: Get or create conversation between two users
//==========================================================
async function getOrCreateConversation(userId1, userId2) {
  // Check if conversation exists
  const conversationsRef = db.collection('conversations');
  const existingConversation = await conversationsRef
    .where('participants', 'array-contains', userId1)
    .get();
  
  for (const doc of existingConversation.docs) {
    const data = doc.data();
    if (data.participants.includes(userId2)) {
      return doc.id;
    }
  }

  // Create new conversation
  const newConversationRef = await conversationsRef.add({
    participants: [userId1, userId2],
    createdAt: new Date(),
    lastMessage: '',
    lastMessageTime: new Date()
  });

  return newConversationRef.id;
}

//===========================================
// Helper: Update user's conversation list
//===========================================
async function updateUserConversation(userId, conversationId, otherUserId, messageData, incrementUnread = false) {
  const userConversationRef = db
    .collection('users')
    .doc(userId)
    .collection('conversations')
    .doc(conversationId);

  const conversationDoc = await userConversationRef.get();
  const otherUserDoc = await db.collection('users').doc(otherUserId).get();
  const otherUserData = otherUserDoc.data();

  const updateData = {
    conversationId,
    otherUserId,
    otherUserName: otherUserData?.fullname || otherUserData?.displayName || otherUserData?.username || 'User',
    otherUserAvatar: otherUserData?.photoURL || null,
    lastMessage: messageData.text || `🎵 Shared a song`,
    lastMessageTime: messageData.timestamp,
    lastMessageSenderId: messageData.senderId,
    updatedAt: new Date()
  };

  if (incrementUnread && messageData.senderId !== userId) {
    if (conversationDoc.exists) {
      updateData.unreadCount = FieldValue.increment(1);
    } else {
      updateData.unreadCount = 1;
    }
  } else if (!conversationDoc.exists) {
    updateData.unreadCount = 0;
  }

  await userConversationRef.set(updateData, { merge: true });
}

//=====================================================
// Helper: Get random gradient for avatar fallback
//=====================================================
function getRandomGradient() {
  const gradients = [
    'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)',
    'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
    'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
    'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
    'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
  ];
  return gradients[Math.floor(Math.random() * gradients.length)];
}

//======================================
// DELETE /api/messages/:messageId
// Delete a message
//======================================
export const deleteMessage = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  const { messageId } = req.params;
  const { conversationId } = req.body;

  try {
    await db
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .doc(messageId)
      .delete();

    return res.status(200).json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting message:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
