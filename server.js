const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

// simple queue (remove complex categories for now)
let queue = [];

// uid → socket map
const userSocket = {};

io.on("connection", socket => {
  console.log("🔥 Connected:", socket.id);

  socket.on("join-queue", ({ uid }) => {
    userSocket[uid] = socket.id;

    // remove duplicates
    queue = queue.filter(u => u.uid !== uid);

    queue.push({ uid });

    console.log("➕ Added:", uid, " Queue:", queue.length);

    matchUsers();
  });

  function matchUsers() {
    if (queue.length >= 2) {
      const u1 = queue.shift();
      const u2 = queue.shift();

      console.log("💚 MATCH:", u1.uid, "<>", u2.uid);

      io.to(userSocket[u1.uid]).emit("match-found", { peerId: u2.uid });
      io.to(userSocket[u2.uid]).emit("match-found", { peerId: u1.uid });
    }
  }

  socket.on("join-call-room", ({ room, uid }) => {
    userSocket[uid] = socket.id;
    socket.join(room);

    console.log("👥", uid, " joined room", room);

    setTimeout(() => {
      socket.to(room).emit("peer-ready", uid);
    }, 300);
  });

  socket.on("send-offer", ({ to, offer }) => {
    io.to(userSocket[to]).emit("receive-offer", offer);
  });

  socket.on("send-answer", ({ to, answer }) => {
    io.to(userSocket[to]).emit("receive-answer", answer);
  });

  socket.on("send-ice", ({ to, candidate }) => {
    io.to(userSocket[to]).emit("receive-ice", candidate);
  });

  socket.on("disconnect", () => {
    for (let uid in userSocket) {
      if (userSocket[uid] === socket.id) {
        delete userSocket[uid];
      }
    }

    queue = queue.filter(u => u.socket !== socket.id);
    console.log("❌ Disconnected:", socket.id);
  });
});

server.listen(8080, () => {
  console.log("🚀 Server running on 8080");
});
