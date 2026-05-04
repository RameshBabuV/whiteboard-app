const express = require("express");
const http = require("http");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;
const path = require("path");

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "teacher.html"));
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
  });

  socket.on("draw", (data) => {
    socket.to(socket.room).emit("draw", data);
  });

  socket.on("clear", () => {
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