const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, { cors: { origin: "*" } });

// 🔥 Queue: { uid, gender, category }
let queue = [];

// uid → socketId
const userSocket = {};

// 🔥 Call room state (shared)
const roomState = {}; // roomName → { users: [], bothReady: false }

// 🚀 MATCHING LOGIC based on category
function canMatch(u1, u2) {
  if (u1.uid === u2.uid) return false;

  // Straight category:
  if (u1.category === "straight" && u2.category === "straight") {
      return (u1.gender === "male" && u2.gender === "female") ||
             (u1.gender === "female" && u2.gender === "male");
  }

  // Gay category:
  if (u1.category === "gay" && u2.category === "gay") {
      return u1.gender === "male" && u2.gender === "male";
  }

  // Lesbian category:
  if (u1.category === "lesbian" && u2.category === "lesbian") {
      return u1.gender === "female" && u2.gender === "female";
  }

  return false;
}

function tryMatch() {
  if (queue.length < 2) return;

  for (let i = 0; i < queue.length; i++) {
    for (let j = i + 1; j < queue.length; j++) {

      if (canMatch(queue[i], queue[j])) {
        const u1 = queue[i];
        const u2 = queue[j];

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

io.on("connection", (socket) => {
  console.log("🔥 Connected:", socket.id);

  // JOIN QUEUE
  socket.on("join-queue", ({ uid, gender, category }) => {
    userSocket[uid] = socket.id;

    queue = queue.filter((u) => u.uid !== uid);

    queue.push({ uid, gender, category });

    console.log("➕ Added:", uid, "Category:", category, "Gender:", gender);
    tryMatch();
  });

  // LEAVE QUEUE
  socket.on("leave-queue", ({ uid }) => {
    queue = queue.filter((u) => u.uid !== uid);
    console.log("🚪 Removed from queue:", uid);
  });

  // -------------------------
  // 🔥 CALL ROOM LOGIC FIXED
  // -------------------------
  socket.on("join-call-room", ({ room, uid }) => {
    userSocket[uid] = socket.id;
    socket.join(room);

    if (!roomState[room]) {
      roomState[room] = { users: [], bothReady: false };
    }

    roomState[room].users.push(uid);

    console.log("👥", uid, "joined room", room);

    // When both users joined → send peer-ready
    if (roomState[room].users.length === 2 && !roomState[room].bothReady) {
      roomState[room].bothReady = true;

      console.log("⚡ Both ready in room:", room);

      // Notify both peers
      io.to(room).emit("peer-ready", { room });
    }
  });

  // SIGNALING FIX (EVENT NAMES MATCHED)
  socket.on("send-offer", ({ to, offer }) => {
    io.to(userSocket[to]).emit("receive-offer", { offer });
  });

  socket.on("send-answer", ({ to, answer }) => {
    io.to(userSocket[to]).emit("receive-answer", { answer });
  });

  socket.on("send-ice", ({ to, candidate, sdpMid, sdpMLineIndex }) => {
    io.to(userSocket[to]).emit("receive-ice", { candidate, sdpMid, sdpMLineIndex });
  });

  // DISCONNECT CLEANUP
  socket.on("disconnect", () => {
    for (let uid in userSocket) {
      if (userSocket[uid] === socket.id) {
        delete userSocket[uid];
        queue = queue.filter((u) => u.uid !== uid);
      }
    }
    console.log("❌ Disconnected:", socket.id);
  });
});

server.listen(8080, () => {
  console.log("🚀 Server running on 8080");
});
