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
  if (!user) return; // authenticate already sent response

  const { conversationId } = req.params;

  // Validate conversationId
  if (!conversationId || conversationId === 'undefined' || conversationId === 'null') {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid conversation ID' 
    });
  }

  try {
    // Check if the conversation exists
    const conversationRef = db.collection('conversations').doc(conversationId);
    const conversationDoc = await conversationRef.get();
    
    if (!conversationDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        message: 'Conversation not found' 
      });
    }

    // Verify user is part of this conversation
    const conversationData = conversationDoc.data();
    const participants = conversationData?.participants || [];
    
    if (!participants.includes(user.id)) {
      return res.status(403).json({ 
        success: false, 
        message: 'You do not have access to this conversation' 
      });
    }

    // Fetch messages
    const messagesSnapshot = await db
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .orderBy('timestamp', 'asc')
      .limit(100) // Limit to prevent large responses
      .get();

    const messages = [];
    
    for (const doc of messagesSnapshot.docs) {
      const msgData = doc.data();
      
      // Safely handle timestamp
      let timestampISO = new Date().toISOString();
      if (msgData.timestamp) {
        if (typeof msgData.timestamp.toDate === 'function') {
          timestampISO = msgData.timestamp.toDate().toISOString();
        } else if (msgData.timestamp.seconds) {
          timestampISO = new Date(msgData.timestamp.seconds * 1000).toISOString();
        } else if (msgData.timestamp.toISOString) {
          timestampISO = msgData.timestamp.toISOString();
        } else if (typeof msgData.timestamp === 'string') {
          timestampISO = msgData.timestamp;
        }
      }
      
      messages.push({
        id: doc.id,
        text: msgData.text || '',
        senderId: msgData.senderId,
        receiverId: msgData.receiverId,
        timestamp: timestampISO,
        isMusic: msgData.isMusic || false,
        musicTitle: msgData.musicTitle || null,
        musicArtist: msgData.musicArtist || null,
        musicUrl: msgData.musicUrl || null,
        read: msgData.read || false
      });
    }

    // Mark messages as read for the current user
    const unreadMessagesQuery = await db
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .where('receiverId', '==', user.id)
      .where('read', '==', false)
      .get();

    const batch = db.batch();
    unreadMessagesQuery.docs.forEach(doc => {
      batch.update(doc.ref, { read: true });
    });
    
    if (!unreadMessagesQuery.empty) {
      await batch.commit();
    }

    // Also update unread count in user's conversation list
    await db
      .collection('users')
      .doc(user.id)
      .collection('conversations')
      .doc(conversationId)
      .update({
        unreadCount: 0
      })
      .catch(err => console.warn('Could not update unread count:', err.message));

    return res.status(200).json({
      success: true,
      messages,
      conversationId
    });
    
  } catch (error) {
    console.error('Error fetching messages:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch messages',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
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

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Recipient user ID is required' });
    }

    // Check if other user exists
    const otherUserDoc = await db.collection('users').doc(userId).get();
    if (!otherUserDoc.exists) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Find or create conversation
    let conversationId = await getOrCreateConversation(user.id, userId);
    
    if (!conversationId) {
      return res.status(500).json({ success: false, message: 'Failed to create conversation' });
    }

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
    const lastMessageText = text || (isMusic ? `🎵 Shared: ${musicTitle} by ${musicArtist}` : '');
    
    await db
      .collection('conversations')
      .doc(conversationId)
      .update({
        lastMessage: lastMessageText,
        lastMessageTime: new Date(),
        lastMessageSenderId: user.id,
        updatedAt: new Date()
      });

    // Update user's conversation list for sender
    await updateUserConversation(user.id, conversationId, userId, messageData, false);
    
    // Update user's conversation list for receiver (with unread count increment)
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
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to send message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

//==========================================================
// Helper: Get or create conversation between two users
//==========================================================
async function getOrCreateConversation(userId1, userId2) {
  try {
    // Check if conversation exists
    const conversationsRef = db.collection('conversations');
    const existingConversation = await conversationsRef
      .where('participants', 'array-contains', userId1)
      .get();
    
    for (const doc of existingConversation.docs) {
      const data = doc.data();
      if (data.participants && data.participants.includes(userId2)) {
        return doc.id;
      }
    }

    // Create new conversation
    const newConversationRef = await conversationsRef.add({
      participants: [userId1, userId2],
      createdAt: new Date(),
      lastMessage: '',
      lastMessageTime: new Date(),
      updatedAt: new Date()
    });

    return newConversationRef.id;
  } catch (error) {
    console.error('Error in getOrCreateConversation:', error);
    return null;
  }
}

// Helper: Update user's conversation list
async function updateUserConversation(userId, conversationId, otherUserId, messageData, incrementUnread = false) {
  try {
    const userConversationRef = db
      .collection('users')
      .doc(userId)
      .collection('conversations')
      .doc(conversationId);

    // Get other user's info
    let otherUserName = 'User';
    let otherUserAvatar = null;
    let otherUserOnline = false;
    
    try {
      const otherUserDoc = await db.collection('users').doc(otherUserId).get();
      if (otherUserDoc.exists) {
        const otherData = otherUserDoc.data();
        otherUserName = otherData.fullname || otherData.displayName || otherData.username || 'User';
        otherUserAvatar = otherData.photoURL || null;
        otherUserOnline = otherData.isOnline || false;
      }
    } catch (err) {
      console.warn('Could not fetch other user info:', err.message);
    }

    const lastMessageText = messageData.text || (messageData.isMusic ? `🎵 Shared a song` : '');
    
    const updateData = {
      conversationId,
      otherUserId,
      otherUserName,
      otherUserAvatar,
      otherUserOnline,
      lastMessage: lastMessageText,
      lastMessageTime: messageData.timestamp,
      lastMessageSenderId: messageData.senderId,
      updatedAt: new Date()
    };

    if (incrementUnread && messageData.senderId !== userId) {
      // Increment unread count for receiver
      const existingDoc = await userConversationRef.get();
      if (existingDoc.exists) {
        updateData.unreadCount = (existingDoc.data().unreadCount || 0) + 1;
      } else {
        updateData.unreadCount = 1;
      }
    } else {
      updateData.unreadCount = 0;
    }

    await userConversationRef.set(updateData, { merge: true });
  } catch (error) {
    console.error('Error updating user conversation:', error);
  }
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

//=========================================================
// GET /api/users/available
// Get all users except current user (for new conversation)
//=========================================================
export const getAvailableUsers = async (req, res, next) => {
  await runMiddleware(req, res, cors);

  const user = await authenticate(req, res);
  if (!user) return;

  try {
    const usersSnapshot = await db.collection('users').get();
    
    const availableUsers = [];
    for (const doc of usersSnapshot.docs) {
      const userData = doc.data();
      if (doc.id !== user.id) {
        availableUsers.push({
          id: doc.id,
          name: userData.fullname || userData.displayName || userData.username || 'User',
          username: userData.username,
          email: userData.email,
          photoURL: userData.photoURL || null,
          isOnline: userData.isOnline || false
        });
      }
    }

    return res.status(200).json({
      success: true,
      users: availableUsers
    });
  } catch (error) {
    console.error('Error fetching available users:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
