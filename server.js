const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  maxHttpBufferSize: 10 * 1024 * 1024
});
const PORT = process.env.PORT || 3000;
const path = require("path");
const roomBoards = new Map();
const sessions = new Map();
const teacherPassword = process.env.TEACHER_PASSWORD || "teacher123";

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const separatorIndex = cookie.indexOf("=");
        if (separatorIndex < 0) return [cookie, ""];

        return [
          decodeURIComponent(cookie.slice(0, separatorIndex)),
          decodeURIComponent(cookie.slice(separatorIndex + 1))
        ];
      })
  );
}

function getSessionId(req) {
  return parseCookies(req.headers.cookie).board_session;
}

function getSession(req) {
  const sessionId = getSessionId(req);
  return sessionId ? sessions.get(sessionId) : null;
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const session = getSession(req);
    const room = sanitizeRoom(req.query.room || "python");

    if (!session || !allowedRoles.includes(session.role)) {
      return res.redirect(`/login.html?role=${allowedRoles[0]}&room=${encodeURIComponent(room)}`);
    }

    req.session = session;
    next();
  };
}

function buildSessionCookie(sessionId) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `board_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`;
}

function sanitizeRoom(room) {
  return String(room).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "python";
}

function getSocketSession(socket) {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  return cookies.board_session ? sessions.get(cookies.board_session) : null;
}

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/api/login", (req, res) => {
  const name = String(req.body.name || "").trim();
  const role = req.body.role === "teacher" ? "teacher" : "student";
  const room = sanitizeRoom(req.body.room || "python");
  const password = String(req.body.password || "");

  if (!name) {
    return res.status(400).json({ error: "Please enter your name." });
  }

  if (role === "teacher" && password !== teacherPassword) {
    return res.status(401).json({ error: "Invalid teacher password." });
  }

  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    name,
    role,
    room,
    createdAt: Date.now()
  });

  res.setHeader("Set-Cookie", buildSessionCookie(sessionId));
  res.json({
    redirectTo: role === "teacher"
      ? `/teacher.html?room=${encodeURIComponent(room)}`
      : `/student.html?room=${encodeURIComponent(room)}`
  });
});

app.get("/api/me", (req, res) => {
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({ error: "Not logged in." });
  }

  res.json(session);
});

app.get("/logout", (req, res) => {
  const sessionId = getSessionId(req);

  if (sessionId) {
    sessions.delete(sessionId);
  }

  res.setHeader("Set-Cookie", "board_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.redirect("/login.html");
});

app.get("/teacher.html", requireRole("teacher"), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "teacher.html"));
});

app.get("/student.html", requireRole("student", "teacher"), (req, res) => {
  res.sendFile(path.join(__dirname, "public", "student.html"));
});

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  console.log("User connected");
  const session = getSocketSession(socket);

  socket.on("joinRoom", (room) => {
    if (!session) return;

    socket.join(room);
    socket.room = room;
    socket.session = session;
    console.log("Joined room:", room);

    const board = roomBoards.get(room) || [];
    socket.emit("boardState", board);
  });

  socket.on("draw", (data) => {
    if (!socket.room) return;
    if (socket.session?.role !== "teacher") return;

    const board = roomBoards.get(socket.room) || [];
    const existingIndex = ["image", "table", "shape"].includes(data.kind) && data.id
      ? board.findIndex((event) => event.id === data.id)
      : -1;

    if (existingIndex >= 0) {
      board[existingIndex] = data;
    } else {
      board.push(data);
    }

    roomBoards.set(socket.room, board);

    socket.to(socket.room).emit("draw", data);
  });

  socket.on("boardState", (board) => {
    if (!socket.room) return;
    if (socket.session?.role !== "teacher") return;

    const nextBoard = Array.isArray(board) ? board : [];
    roomBoards.set(socket.room, nextBoard);
    socket.to(socket.room).emit("boardState", nextBoard);
  });

  socket.on("clear", () => {
    if (!socket.room) return;
    if (socket.session?.role !== "teacher") return;

    roomBoards.set(socket.room, []);
    socket.to(socket.room).emit("clear");
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
  socket.on("chat", (data) => {
    if (!socket.room || !socket.session) return;

    io.to(socket.room).emit("chat", {
      name: socket.session.name,
      msg: String(data?.msg || ""),
      role: socket.session.role
    });
  });
});

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
