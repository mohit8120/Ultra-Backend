const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------------------------------------------
// Firebase Admin Init (Railway)
// ------------------------------------------------------------
try {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const serviceAccount = JSON.parse(saJson);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    console.log("✅ Firebase Admin initialized with service account");
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    console.log("✅ Firebase Admin initialized with ADC");
  }
} catch (e) {
  console.error("❌ Firebase Admin init failed:", e);
}

const firestore = admin.firestore();
const bucket = admin.storage().bucket();

// Helper to parse storage path from download URL
function storagePathFromUrl(url) {
  try {
    const u = new URL(url);
    const idx = u.pathname.indexOf("/o/");
    if (idx >= 0) {
      const enc = u.pathname.substring(idx + 3);
      const qmIdx = enc.indexOf("?");
      const encodedPath = qmIdx >= 0 ? enc.substring(0, qmIdx) : enc;
      return decodeURIComponent(encodedPath);
    }
    return null;
  } catch {
    return null;
  }
}

// Batch delete helper (handles up to 500 ops per batch)
async function batchDeleteQuery(snap) {
  const commits = [];
  let batch = firestore.batch();
  let count = 0;
  snap.forEach((doc) => {
    batch.delete(doc.ref);
    count++;
    if (count >= 450) {
      commits.push(batch.commit());
      batch = firestore.batch();
      count = 0;
    }
  });
  if (count > 0) commits.push(batch.commit());
  await Promise.all(commits);
}

// Core cleanup routine
async function cleanupUserData(userId) {
  console.log(`🧹 Starting cleanup for deleted user ${userId}`);

  // 1) Delete all posts created by the user (plus their storage)
  try {
    const postsSnap = await firestore.collection("posts").where("userId", "==", userId).get();
    if (!postsSnap.empty) {
      // Delete storage files per post
      for (const doc of postsSnap.docs) {
        const post = doc.data() || {};
        const urls = [post.imageUrl, post.voiceUrl].filter(Boolean);
        const storagePaths = [post.storagePath].filter(Boolean);
        try {
          for (const p of storagePaths) {
            await bucket.file(p).delete({ ignoreNotFound: true });
          }
          for (const url of urls) {
            const path = storagePathFromUrl(url);
            if (path) await bucket.file(path).delete({ ignoreNotFound: true });
          }
        } catch (err) {
          console.error(`Error deleting storage for post ${doc.id}:`, err);
        }

        // Delete comments under the post
        try {
          const commentsSnap = await firestore.collection("posts").doc(doc.id).collection("comments").get();
          if (!commentsSnap.empty) await batchDeleteQuery(commentsSnap);
        } catch (err) {
          console.error(`Error deleting comments for post ${doc.id}:`, err);
        }
      }

      // Delete the posts themselves
      await batchDeleteQuery(postsSnap);
      console.log(`Deleted ${postsSnap.size} top-level posts for user ${userId}`);
    }
  } catch (error) {
    console.error(`Error deleting posts for user ${userId}:`, error);
  }

  // 2) Delete any user-copy posts under users/{uid}/posts
  try {
    const userPostsSnap = await firestore.collection("users").doc(userId).collection("posts").get();
    if (!userPostsSnap.empty) {
      await batchDeleteQuery(userPostsSnap);
      console.log(`Deleted ${userPostsSnap.size} user post copies under users/${userId}/posts`);
    }
  } catch (error) {
    console.error(`Error deleting users/${userId}/posts:`, error);
  }

  // 3) Delete notifications targeting this user
  try {
    const notifTargetSnap = await firestore.collection("notifications").where("targetUserId", "==", userId).get();
    if (!notifTargetSnap.empty) {
      await batchDeleteQuery(notifTargetSnap);
      console.log(`Deleted ${notifTargetSnap.size} notifications targeting user ${userId}`);
    }
  } catch (error) {
    console.error(`Error deleting notifications targeting user ${userId}:`, error);
  }

  // 4) Delete notifications created by this user
  try {
    const notifTriggerSnap = await firestore.collection("notifications").where("triggeringUserId", "==", userId).get();
    if (!notifTriggerSnap.empty) {
      await batchDeleteQuery(notifTriggerSnap);
      console.log(`Deleted ${notifTriggerSnap.size} notifications created by user ${userId}`);
    }
  } catch (error) {
    console.error(`Error deleting notifications triggered by user ${userId}:`, error);
  }

  // 5) Delete nested notifications under notifications/{uid}/userNotifications
  try {
    const nestedNotifsSnap = await firestore.collection("notifications").doc(userId).collection("userNotifications").get();
    if (!nestedNotifsSnap.empty) {
      await batchDeleteQuery(nestedNotifsSnap);
      console.log(`Deleted ${nestedNotifsSnap.size} notifications under notifications/${userId}/userNotifications`);
    }
    await firestore.collection("notifications").doc(userId).delete().catch(() => {});
  } catch (error) {
    console.error(`Error deleting nested notifications for user ${userId}:`, error);
  }

  // 6) Delete user's inbox entries: inbox/{uid}/conversations/* and the container doc
  try {
    const inboxSnap = await firestore.collection("inbox").doc(userId).collection("conversations").get();
    if (!inboxSnap.empty) {
      await batchDeleteQuery(inboxSnap);
      console.log(`Deleted ${inboxSnap.size} inbox conversations for user ${userId}`);
    }
    await firestore.collection("inbox").doc(userId).delete().catch(() => {});
  } catch (error) {
    console.error(`Error deleting inbox for user ${userId}:`, error);
  }

  console.log(`✅ Cleanup completed for deleted user ${userId}`);
}

// ------------------------------------------------------------
// Secure HTTP route to trigger cleanup from app (Railway)
// ------------------------------------------------------------
app.post("/cleanup/user-delete", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: "Missing Authorization Bearer token" });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    const uidFromToken = decoded.uid;
    const { uid } = req.body || {};
    if (!uid) {
      return res.status(400).json({ error: "Missing uid in request body" });
    }
    if (uid !== uidFromToken) {
      return res.status(403).json({ error: "Not allowed to delete another user" });
    }

    await cleanupUserData(uid);
    return res.json({ ok: true });
  } catch (e) {
    console.error("Cleanup route error:", e);
    return res.status(500).json({ error: "Internal error", details: e.message });
  }
});

const server = http.createServer(app);

const io = new Server(server, { cors: { origin: "*" } });

// Queue objects
let queue = []; // { uid, gender, category }

// uid → socketId map
const userSocket = {};

// Room state
const roomState = {}; 
// room → { users: [], ready: false }

// ------------------------------------------------------------
// MATCHING RULES
// ------------------------------------------------------------
function canMatch(u1, u2) {

  if (u1.uid === u2.uid) return false;
  if (u1.category !== u2.category) return false;

  // Straight → male–female only
  if (u1.category === "straight") {
    return (
      (u1.gender === "male" && u2.gender === "female") ||
      (u1.gender === "female" && u2.gender === "male")
    );
  }

  // Gay → male–male
  if (u1.category === "gay") {
    return u1.gender === "male" && u2.gender === "male";
  }

  // Lesbian → female–female
  if (u1.category === "lesbian") {
    return u1.gender === "female" && u2.gender === "female";
  }

  return false;
}

// ------------------------------------------------------------
// TRY TO MATCH
// ------------------------------------------------------------
function tryMatch() {
  if (queue.length < 2) return;

  for (let i = 0; i < queue.length; i++) {
    for (let j = i + 1; j < queue.length; j++) {
      const u1 = queue[i];
      const u2 = queue[j];

      if (canMatch(u1, u2)) {
        queue.splice(j, 1);
        queue.splice(i, 1);

        console.log("💚 MATCH:", u1.uid, "<>", u2.uid);

        io.to(userSocket[u1.uid]).emit("match-found", { peerId: u2.uid });
        io.to(userSocket[u2.uid]).emit("match-found", { peerId: u1.uid });

        return;
      }
    }
  }
}

// ------------------------------------------------------------
// SOCKET EVENTS
// ------------------------------------------------------------
io.on("connection", (socket) => {
  console.log("🔥 Connected:", socket.id);

  // JOIN QUEUE
  socket.on("join-queue", ({ uid, gender, category }) => {
    userSocket[uid] = socket.id;

    queue = queue.filter((u) => u.uid !== uid);

    queue.push({ uid, gender, category });

    console.log("➕ Added:", uid, category, gender);
    tryMatch();
  });

  // LEAVE QUEUE
  socket.on("leave-queue", ({ uid }) => {
    queue = queue.filter((u) => u.uid !== uid);
    console.log("🚪 Removed:", uid);
  });

  // ------------------------------------------------------------
  // CALL ROOM LOGIC (FIXED)
  // ------------------------------------------------------------
  socket.on("join-call-room", ({ room, uid }) => {
    userSocket[uid] = socket.id;
    socket.join(room);

    if (!roomState[room]) {
      roomState[room] = { users: [], ready: false };
    }

    if (!roomState[room].users.includes(uid)) {
      roomState[room].users.push(uid);
    }

    console.log("👥", uid, "joined", room);

    if (roomState[room].users.length === 2 && !roomState[room].ready) {
      roomState[room].ready = true;

      console.log("⚡ Both ready in room:", room);
      io.to(room).emit("peer-ready", { room });
    }
  });

  // ⭐ NEW: Handle leaving call room properly
  socket.on("leave-call-room", ({ room, uid }) => {
    console.log("🚪", uid, "left room", room);
    
    socket.leave(room);
    
    // Clean up room state
    if (roomState[room]) {
      roomState[room].users = roomState[room].users.filter(u => u !== uid);
      
      // If room is empty, delete it completely
      if (roomState[room].users.length === 0) {
        delete roomState[room];
        console.log("🗑️ Room deleted:", room);
      }
    }
  });

  // ------------------------------------------------------------
  // SIGNALING RELAY
  // ------------------------------------------------------------
  socket.on("send-offer", ({ to, offer }) => {
    io.to(userSocket[to]).emit("receive-offer", { offer });
  });

  socket.on("send-answer", ({ to, answer }) => {
    io.to(userSocket[to]).emit("receive-answer", { answer });
  });

  socket.on("send-ice", ({ to, candidate, sdpMid, sdpMLineIndex }) => {
    io.to(userSocket[to]).emit("receive-ice", { candidate, sdpMid, sdpMLineIndex });
  });

  // ------------------------------------------------------------
  // DISCONNECT CLEANUP (ENHANCED)
  // ------------------------------------------------------------
  socket.on("disconnect", () => {
    // Find which user disconnected
    let disconnectedUid = null;
    for (const uid in userSocket) {
      if (userSocket[uid] === socket.id) {
        disconnectedUid = uid;
        delete userSocket[uid];
        queue = queue.filter((u) => u.uid !== uid);
        break;
      }
    }

    // Clean up ALL rooms this user was in
    if (disconnectedUid) {
      for (const room in roomState) {
        if (roomState[room].users.includes(disconnectedUid)) {
          roomState[room].users = roomState[room].users.filter(u => u !== disconnectedUid);
          
          // Notify the other user that peer disconnected
          io.to(room).emit("peer-disconnected", { uid: disconnectedUid });
          
          // Delete empty rooms
          if (roomState[room].users.length === 0) {
            delete roomState[room];
            console.log("🗑️ Room auto-deleted on disconnect:", room);
          }
        }
      }
    }

    console.log("❌ Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log("🚀 Server running on " + PORT);
});
