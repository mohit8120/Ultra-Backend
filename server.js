const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"],
  allowEIO3: true
});

console.log("🚀 SERVER STARTING...");

io.on("connection", (socket) => {
  console.log("\n📱 USER CONNECTED");
  console.log("  ├─ Socket ID: " + socket.id);
  console.log("  ├─ Total clients: " + io.engine.clientsCount);
  console.log("  └─ Time: " + new Date().toLocaleTimeString());

  // ✅ JOIN-QUEUE: Just receive and log
  socket.on("join-queue", (data) => {
    console.log("\n🔔 JOIN-QUEUE RECEIVED");
    console.log("  ├─ UID: " + data.uid);
    console.log("  ├─ Gender: " + data.gender);
    console.log("  ├─ Category: " + data.category);
    console.log("  └─ Socket: " + socket.id);
  });

  // ✅ SEND-OFFER: Just receive and log
  socket.on("send-offer", (data) => {
    console.log("\n📤 OFFER RECEIVED");
    console.log("  ├─ From: " + data.from);
    console.log("  ├─ To: " + data.to);
    console.log("  └─ Offer length: " + data.offer.length + " chars");
  });

  // ✅ SEND-ANSWER: Just receive and log
  socket.on("send-answer", (data) => {
    console.log("\n📤 ANSWER RECEIVED");
    console.log("  ├─ From: " + data.from);
    console.log("  ├─ To: " + data.to);
    console.log("  └─ Answer length: " + data.answer.length + " chars");
  });

  // ✅ SEND-ICE-CANDIDATE: Just receive and log
  socket.on("send-ice-candidate", (data) => {
    console.log("\n🧊 ICE CANDIDATE RECEIVED");
    console.log("  ├─ From: " + data.from);
    console.log("  ├─ To: " + data.to);
    console.log("  └─ Candidate: " + data.candidate.substring(0, 50) + "...");
  });

  // ✅ REQUEUE: Just receive and log
  socket.on("requeue", (data) => {
    console.log("\n🔄 REQUEUE RECEIVED");
    console.log("  ├─ UID: " + data.uid);
    console.log("  ├─ Category: " + data.category);
    console.log("  └─ Gender: " + data.gender);
  });

  // ✅ DISCONNECT: Just log
  socket.on("disconnect", () => {
    console.log("\n❌ USER DISCONNECTED");
    console.log("  ├─ Socket ID: " + socket.id);
    console.log("  ├─ Total clients now: " + (io.engine.clientsCount - 1));
    console.log("  └─ Time: " + new Date().toLocaleTimeString());
  });

  // ✅ ERROR: Just log
  socket.on("error", (err) => {
    console.log("\n⚠️ SOCKET ERROR: " + err);
  });
});

// ✅ CONFIGURABLE PORT
const PORT = process.env.PORT || 4000;

// SERVER LISTEN
server.listen(PORT, "0.0.0.0", () => {
  console.log("\n✅ SERVER STARTED ON PORT " + PORT);
  console.log("🌐 http://0.0.0.0:" + PORT);
  console.log("✓ Ready to receive events\n");
});

server.on("error", (err) => {
  console.log("❌ SERVER ERROR: " + err.message);
});
