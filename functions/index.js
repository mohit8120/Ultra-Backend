// NOTE: This is Firebase Cloud Functions backend code.
// Recommended: move `functions/` to your backend repo (Ultra-Backend) and deploy from there.
// It is not part of the Android app build and runs on Firebase servers.

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

// Helper to parse storage path from download URL
function storagePathFromUrl(url) {
  try {
    const u = new URL(url);
    // URL format: /v0/b/<bucket>/o/<pathEncoded>
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
async function batchDeleteQuery(snap, db) {
  const commits = [];
  let batch = db.batch();
  let count = 0;
  snap.forEach((doc) => {
    batch.delete(doc.ref);
    count++;
    if (count >= 450) {
      commits.push(batch.commit());
      batch = db.batch();
      count = 0;
    }
  });
  if (count > 0) commits.push(batch.commit());
  await Promise.all(commits);
}

// Deletes a user's post copy, files, comments, and notifications when a post is deleted
exports.onDeletePost = functions.firestore
  .document("posts/{postId}")
  .onDelete(async (snap, context) => {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();

    const deletedPost = snap.data() || {};
    const userId = deletedPost.userId;
    const postId = context.params.postId;

    // 1) Delete user's profile post doc copy
    if (userId) {
      const userPostRef = db.collection("users").doc(userId).collection("posts").doc(postId);
      try {
        await userPostRef.delete();
        console.log(`Deleted user copy for post ${postId}`);
      } catch (error) {
        console.error(`Error deleting user copy for post ${postId}:`, error);
      }
    }

    // 2) Delete associated storage file(s)
    const urls = [deletedPost.imageUrl, deletedPost.voiceUrl];
    // Prefer storagePath if you store it
    const storagePaths = [deletedPost.storagePath].filter(Boolean);
    try {
      for (const p of storagePaths) {
        await bucket.file(p).delete({ ignoreNotFound: true });
        console.log(`Deleted storage file by storagePath ${p}`);
      }
      for (const url of urls.filter(Boolean)) {
        const path = storagePathFromUrl(url);
        if (path) {
          await bucket.file(path).delete({ ignoreNotFound: true });
          console.log(`Deleted storage file by URL path ${path}`);
        }
      }
    } catch (error) {
      console.error(`Error deleting storage files for post ${postId}:`, error);
    }

    // 3) Delete all comments under the post
    try {
      const commentsSnap = await db.collection("posts").doc(postId).collection("comments").get();
      if (!commentsSnap.empty) {
        await batchDeleteQuery(commentsSnap, db);
        console.log(`Deleted comments for post ${postId}`);
      }
    } catch (error) {
      console.error(`Error deleting comments for post ${postId}:`, error);
    }

    // 4) Delete notifications referencing this post
    try {
      const notifSnap = await db.collection("notifications").where("postId", "==", postId).get();
      if (!notifSnap.empty) {
        await batchDeleteQuery(notifSnap, db);
        console.log(`Deleted notifications for post ${postId}`);
      }
    } catch (error) {
      console.error(`Error deleting notifications for post ${postId}:`, error);
    }
  });

// Deletes chat and all messages when both users mark it as deleted
exports.cleanupChatWhenBothDeleted = functions.firestore
  .document("chats/{chatId}")
  .onUpdate(async (change, context) => {
    const db = admin.firestore();
    const chatId = context.params.chatId;

    const after = change.after.data();
    if (!after?.deletedFor) return;

    const deletedFor = after.deletedFor;
    const users = Object.keys(deletedFor);

    // Check if both users marked as deleted
    const allDeleted = users.length >= 2 && users.every(u => deletedFor[u] === true);
    if (!allDeleted) {
      console.log(`⏳ Chat ${chatId}: waiting for both users to delete`);
      return;
    }

    console.log(`🗑️ Both users deleted chat ${chatId}. Cleaning up…`);

    try {
      // ✅ FIX: Delete messages FIRST, then chat doc (atomic-ish)
      const msgsSnap = await db.collection("chats").doc(chatId).collection("messages").get();
      
      if (!msgsSnap.empty) {
        await batchDeleteQuery(msgsSnap, db);
        console.log(`Deleted ${msgsSnap.size} messages from chat ${chatId}`);
      }

      // Delete chat document itself LAST
      await db.collection("chats").doc(chatId).delete();
      console.log(`✅ Chat ${chatId} fully removed from Firestore`);
    } catch (error) {
      console.error(`Error cleaning up chat ${chatId}:`, error);
    }
  });
