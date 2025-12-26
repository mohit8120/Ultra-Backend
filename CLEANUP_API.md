# Cleanup API Documentation

## Base URL
Your Railway deployment URL (e.g., `https://ultra-backend-production.up.railway.app`)

---

## 1. User Account Deletion Cleanup
**Endpoint:** `POST /cleanup/user-delete`

**Description:** Deletes all user data when account is deleted (posts, comments, notifications, inbox).

**Headers:**
```
Authorization: Bearer <Firebase_ID_Token>
Content-Type: application/json
```

**Body:**
```json
{
  "uid": "<user_uid>"
}
```

**Response:**
```json
{
  "ok": true
}
```

**What Gets Deleted:**
- All posts owned by the user (+ storage files + post comments)
- User-copy posts under `users/{uid}/posts`
- Notifications targeting the user
- Notifications created by the user
- Nested notifications `notifications/{uid}/userNotifications`
- Inbox conversations `inbox/{uid}/conversations`
- All comments made by the user on any posts

**Android Integration:**
Call this **before** deleting the Firebase Auth user in `ProfileActivity.deleteAccount()`:
```java
// 1. Get ID token
FirebaseAuth.getInstance().getCurrentUser().getIdToken(true)
    .addOnSuccessListener(result -> {
        String token = result.getToken();
        
        // 2. Call cleanup endpoint
        OkHttpClient client = new OkHttpClient();
        JSONObject body = new JSONObject();
        body.put("uid", currentUserId);
        
        RequestBody requestBody = RequestBody.create(
            body.toString(), 
            MediaType.parse("application/json")
        );
        
        Request request = new Request.Builder()
            .url("https://YOUR_RAILWAY_URL/cleanup/user-delete")
            .addHeader("Authorization", "Bearer " + token)
            .post(requestBody)
            .build();
        
        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onResponse(Call call, Response response) {
                // 3. After cleanup success, delete Auth user
                FirebaseAuth.getInstance().getCurrentUser().delete();
                // 4. Delete Firestore user doc
                db.collection("users").document(currentUserId).delete();
            }
        });
    });
```

---

## 2. Expired Posts Cleanup (Scheduled Job)
**Endpoint:** `POST /cleanup/expired-posts`

**Description:** Deletes all posts past their 2-hour expiry (+ storage + comments + notifications).

**No Auth Required** (intended for Railway Cron or internal scheduled calls)

**Response:**
```json
{
  "ok": true,
  "deletedCount": 12
}
```

**What Gets Deleted:**
- Posts where `expiryTimestamp <= now`
- Storage files (image/voice)
- All comments under the post
- User-copy posts under `users/{uid}/posts/{postId}`
- Notifications referencing the post

**Railway Cron Setup:**
1. Go to Railway project settings
2. Add a Cron Job trigger (if available), or use an external cron service like cron-job.org
3. Schedule: `*/30 * * * *` (every 30 minutes)
4. URL: `https://YOUR_RAILWAY_URL/cleanup/expired-posts`
5. Method: POST

**Alternative (GitHub Actions cron):**
Create `.github/workflows/cleanup-posts.yml`:
```yaml
name: Cleanup Expired Posts
on:
  schedule:
    - cron: '*/30 * * * *'  # Every 30 min
  workflow_dispatch:

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Call cleanup endpoint
        run: |
          curl -X POST https://YOUR_RAILWAY_URL/cleanup/expired-posts
```

---

## 3. Manual Post Deletion
**Endpoint:** `POST /cleanup/delete-post`

**Description:** User manually deletes their post from the app.

**Headers:**
```
Authorization: Bearer <Firebase_ID_Token>
Content-Type: application/json
```

**Body:**
```json
{
  "postId": "<post_id>"
}
```

**Response:**
```json
{
  "ok": true
}
```

**What Gets Deleted:**
- The post document
- Storage files (image/voice)
- All comments under the post
- User-copy post under `users/{uid}/posts/{postId}`
- Notifications referencing the post

**Android Integration:**
In `PostAdapter` or wherever user deletes a post:
```java
FirebaseAuth.getInstance().getCurrentUser().getIdToken(true)
    .addOnSuccessListener(result -> {
        String token = result.getToken();
        
        OkHttpClient client = new OkHttpClient();
        JSONObject body = new JSONObject();
        body.put("postId", postId);
        
        RequestBody requestBody = RequestBody.create(
            body.toString(), 
            MediaType.parse("application/json")
        );
        
        Request request = new Request.Builder()
            .url("https://YOUR_RAILWAY_URL/cleanup/delete-post")
            .addHeader("Authorization", "Bearer " + token)
            .post(requestBody)
            .build();
        
        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onResponse(Call call, Response response) {
                // Post deleted successfully
                Toast.makeText(context, "Post deleted", Toast.LENGTH_SHORT).show();
            }
        });
    });
```

---

## 4. Chat & Notification Deletion (Already Handled)

### Chat Deletion
- **App Side:** `InboxAdapter.deleteConversation()` already deletes `inbox/{uid}/conversations/{otherId}`
- **Backend Side:** Cloud Function `cleanupChatWhenBothDeleted` (in `functions/index.js`) triggers when both users delete, removing `chats/{chatId}/messages`

**No additional API needed** - works as-is.

### Notification Deletion
- **App Side:** When user deletes a notification, call:
  ```java
  // Top-level notifications
  db.collection("notifications").document(notificationId).delete();
  
  // OR nested notifications
  db.collection("notifications").document(currentUserId)
      .collection("userNotifications").document(notificationId).delete();
  ```

**No additional API needed** - direct Firestore delete is fine.

---

## Security Notes
- All authenticated routes verify the Firebase ID token
- Users can only delete their own data (uid/postId ownership verified)
- Expired posts cleanup is public (no sensitive data exposed, just count)

---

## Testing

### Test User Deletion
```bash
# Get token from app or Firebase Auth REST API
curl -X POST https://YOUR_RAILWAY_URL/cleanup/user-delete \
  -H "Authorization: Bearer YOUR_ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"uid":"USER_UID"}'
```

### Test Expired Posts
```bash
curl -X POST https://YOUR_RAILWAY_URL/cleanup/expired-posts
```

### Test Manual Post Delete
```bash
curl -X POST https://YOUR_RAILWAY_URL/cleanup/delete-post \
  -H "Authorization: Bearer YOUR_ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"postId":"POST_ID"}'
```

---

## Deployment Checklist
- ✅ Railway env vars set: (none required if using applicationDefault)
- ✅ Firebase Admin SDK initialized with `camverz.appspot.com` bucket
- ✅ Push changes to GitHub (Railway auto-deploys)
- ✅ Set up cron for expired posts cleanup
- ✅ Update Android app to call cleanup endpoints
- ✅ Test each route with real data

---

## Expected Logs (Railway)
```
✅ Firebase Admin initialized with ADC
🚀 Server running on 8080
🧹 Starting cleanup for deleted user abc123
Deleted 5 top-level posts for user abc123
Deleted 12 comments made by user abc123
Deleted 3 inbox conversations for user abc123
✅ Cleanup completed for deleted user abc123
🧹 Deleted 8 expired posts
🗑️ Deleted post xyz789
```
