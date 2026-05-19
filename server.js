const express = require("express");
const http = require("http");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  maxHttpBufferSize: 10 * 1024 * 1024
});
const PORT = process.env.PORT || 3000;
const path = require("path");
const roomBoards = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/teacher.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "teacher.html"));
});

app.get("/student.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "student.html"));
});

io.on("connection", (socket) => {
  console.log("User connected");

  socket.on("joinRoom", (room) => {
    socket.join(room);
    socket.room = room;
    console.log("Joined room:", room);

    const board = roomBoards.get(room) || [];
    board.forEach((data) => socket.emit("draw", data));
  });

  socket.on("draw", (data) => {
    if (!socket.room) return;

    const board = roomBoards.get(socket.room) || [];
    const existingIndex = data.kind === "image" && data.id
      ? board.findIndex((event) => event.kind === "image" && event.id === data.id)
      : -1;

    if (existingIndex >= 0) {
      board[existingIndex] = data;
    } else {
      board.push(data);
    }

    roomBoards.set(socket.room, board);

    socket.to(socket.room).emit("draw", data);
  });

  socket.on("clear", () => {
    if (!socket.room) return;

    roomBoards.set(socket.room, []);
    socket.to(socket.room).emit("clear");
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
  socket.on("chat", (data) => {
  io.to(socket.room).emit("chat", data);
  });
});

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
