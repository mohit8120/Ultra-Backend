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

const queues = {
  gay: [],
  lesbian: [],
  straight_male: [],
  straight_female: []
};

function tryMatch() {
  if (queues.gay.length >= 2) {
    const user1 = queues.gay.shift();
    const user2 = queues.gay.shift();
    matchUsers(user1, user2);
  }

  if (queues.lesbian.length >= 2) {
    const user1 = queues.lesbian.shift();
    const user2 = queues.lesbian.shift();
    matchUsers(user1, user2);
  }

  if (queues.straight_male.length > 0 && queues.straight_female.length > 0) {
    const male = queues.straight_male.shift();
    const female = queues.straight_female.shift();
    matchUsers(male, female);
  }
}

function matchUsers(user1, user2) {
  console.log("\n✅ MATCH FOUND!");
  console.log("  ├─ User 1: " + user1.uid + " (Socket: " + user1.socket + ")");
  console.log("  ├─ User 2: " + user2.uid + " (Socket: " + user2.socket + ")");
  console.log("  └─ Sending match-found to both users");

  io.to(user1.socket).emit("match-found", {
    peerId: user2.uid,
    initiator: true
  });

  io.to(user2.socket).emit("match-found", {
    peerId: user1.uid,
    initiator: false
  });

  console.log("✓ Match-found events sent to both users\n");
}

function printQueueStatus(reason = "") {
  console.log("\n📊 QUEUE STATUS " + (reason ? "(" + reason + ")" : ""));
  console.log("  ├─ Gay: " + queues.gay.length);
  console.log("  ├─ Lesbian: " + queues.lesbian.length);
  console.log("  ├─ Straight Male: " + queues.straight_male.length);
  console.log("  └─ Straight Female: " + queues.straight_female.length);
}

io.on("connection", (socket) => {
  console.log("\n📱 USER CONNECTED");
  console.log("  ├─ Socket ID: " + socket.id);
  console.log("  ├─ Total clients: " + io.engine.clientsCount);
  console.log("  └─ Time: " + new Date().toLocaleTimeString());

  socket.on("join-queue", (data) => {
    console.log("\n🔔 JOIN-QUEUE RECEIVED");
    console.log("  ├─ UID: " + data.uid);
    console.log("  ├─ Gender: " + data.gender);
    console.log("  ├─ Category: " + data.category);
    console.log("  └─ Socket: " + socket.id);

    const user = {
      uid: data.uid,
      gender: data.gender,
      category: data.category,
      socket: socket.id
    };

    if (data.category === "gay") {
      queues.gay.push(user);
      console.log("✓ Added to GAY queue");
    } else if (data.category === "lesbian") {
      queues.lesbian.push(user);
      console.log("✓ Added to LESBIAN queue");
    } else if (data.category === "straight") {
      if (data.gender === "male") {
        queues.straight_male.push(user);
        console.log("✓ Added MALE to STRAIGHT queue");
      } else {
        queues.straight_female.push(user);
        console.log("✓ Added FEMALE to STRAIGHT queue");
      }
    }

    printQueueStatus("User joined " + data.category);
    tryMatch();
  });

  socket.on("send-offer", (data) => {
    console.log("\n📤 OFFER RECEIVED");
    console.log("  ├─ From: " + data.from);
    console.log("  ├─ To: " + data.to);
    console.log("  └─ Offer length: " + data.offer.length + " chars");
    
    io.to(data.to).emit("send-offer", data);
  });

  socket.on("send-answer", (data) => {
    console.log("\n📤 ANSWER RECEIVED");
    console.log("  ├─ From: " + data.from);
    console.log("  ├─ To: " + data.to);
    console.log("  └─ Answer length: " + data.answer.length + " chars");
    
    io.to(data.to).emit("send-answer", data);
  });

  socket.on("send-ice-candidate", (data) => {
    console.log("\n🧊 ICE CANDIDATE RECEIVED");
    console.log("  ├─ From: " + data.from);
    console.log("  ├─ To: " + data.to);
    
    io.to(data.to).emit("send-ice-candidate", data);
  });

  socket.on("disconnect", () => {
    console.log("\n❌ USER DISCONNECTED");
    console.log("  ├─ Socket ID: " + socket.id);
    console.log("  ├─ Total clients now: " + (io.engine.clientsCount - 1));
    console.log("  └─ Time: " + new Date().toLocaleTimeString());

    for (let category in queues) {
      queues[category] = queues[category].filter(u => u.socket !== socket.id);
    }
    
    printQueueStatus("User disconnected");
  });

  socket.on("error", (err) => {
    console.log("\n⚠️ SOCKET ERROR: " + err);
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, "0.0.0.0", () => {
  console.log("\n✅ SERVER STARTED ON PORT " + PORT);
  console.log("🌐 http://0.0.0.0:" + PORT);
  console.log("✓ Ready to receive events\n");
});

server.on("error", (err) => {
  console.log("❌ SERVER ERROR: " + err.message);
});
