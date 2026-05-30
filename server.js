const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

loadEnvFile();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  maxHttpBufferSize: 10 * 1024 * 1024
});
const PORT = process.env.PORT || 3000;
const roomBoards = new Map();
const sessions = new Map();
const teacherPassword = process.env.TEACHER_PASSWORD;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseApiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

function loadEnvFile() {
  const envFiles = [
    process.env.ENV_FILE,
    process.env.NODE_ENV ? `.env.${process.env.NODE_ENV}` : null,
    ".env.prod",
    ".env"
  ].filter(Boolean);

  envFiles.forEach((envFile) => {
    const envPath = path.isAbsolute(envFile) ? envFile : path.join(__dirname, envFile);
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

    lines.forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith("#")) return;

      const separatorIndex = trimmedLine.indexOf("=");
      if (separatorIndex < 0) return;

      const key = trimmedLine.slice(0, separatorIndex).trim();
      const value = trimmedLine.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    });
  });
}

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

async function verifyTeacherLogin(username, password) {
  if (supabaseUrl && supabaseApiKey) {
    try {
      const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/verify_teacher_login`, {
        method: "POST",
        headers: {
          apikey: supabaseApiKey,
          Authorization: `Bearer ${supabaseApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          p_username: username,
          p_password: password
        })
      });

      if (!response.ok) {
        console.error("Supabase teacher login failed:", response.status, await response.text());
        return null;
      }

      const teachers = await response.json();
      return Array.isArray(teachers) && teachers.length > 0 ? teachers[0] : null;
    } catch (error) {
      console.error("Supabase teacher login error:", error);
      return null;
    }
  }

  if (teacherPassword) {
    return password === teacherPassword
      ? { username, display_name: username }
      : null;
  }

  console.error("Teacher login is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  return null;
}

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/api/login", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const role = req.body.role === "teacher" ? "teacher" : "student";
  const room = sanitizeRoom(req.body.room || "python");
  const password = String(req.body.password || "");

  if (!name) {
    return res.status(400).json({ error: "Please enter your name." });
  }

  let sessionName = name;
  let teacher = null;

  if (role === "teacher") {
    teacher = await verifyTeacherLogin(name, password);

    if (!teacher) {
      return res.status(401).json({ error: "Invalid teacher username or password." });
    }

    sessionName = teacher.display_name || teacher.username || name;
  }

  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    name: sessionName,
    role,
    room,
    teacherId: teacher?.id,
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
    const existingIndex = ["background", "image", "table", "shape"].includes(data.kind) && data.id
      ? board.findIndex((event) => event.id === data.id)
      : -1;

    if (existingIndex >= 0) {
      if (data.bringToFront) {
        board.splice(existingIndex, 1);
        board.push(data);
      } else {
        board[existingIndex] = data;
      }
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
