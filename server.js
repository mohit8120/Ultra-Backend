const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

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
