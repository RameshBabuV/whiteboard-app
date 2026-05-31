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
const roomCalls = new Map();
const roomScreenShares = new Map();
const roomScreenPermissions = new Map();
const teacherPassword = process.env.TEACHER_PASSWORD;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseApiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const sessionSecret = process.env.SESSION_SECRET || "local-session-secret";

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
  return getSessionByCookieValue(sessionId);
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

function getSessionByCookieValue(cookieValue) {
  if (!cookieValue) return null;

  const signedSession = parseSignedSession(cookieValue);
  if (signedSession) return signedSession;

  return sessions.get(cookieValue) || null;
}

function signSession(session) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", sessionSecret)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function parseSignedSession(cookieValue) {
  const [payload, signature] = String(cookieValue).split(".");
  if (!payload || !signature) return null;

  const expectedSignature = crypto
    .createHmac("sha256", sessionSecret)
    .update(payload)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function buildSessionCookie(session) {
  const sessionValue = signSession(session);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `board_session=${encodeURIComponent(sessionValue)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`;
}

function sanitizeRoom(room) {
  return String(room).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "python";
}

function getSocketSession(socket) {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  return getSessionByCookieValue(cookies.board_session);
}

function getRoomStudents(room) {
  const roomSockets = io.sockets.adapter.rooms.get(room) || new Set();

  return [...roomSockets]
    .map((socketId) => io.sockets.sockets.get(socketId))
    .filter((roomSocket) => roomSocket?.session?.role === "student")
    .map((roomSocket) => ({
      id: roomSocket.id,
      name: roomSocket.session.name
    }))
    .sort((first, second) => first.name.localeCompare(second.name));
}

function emitStudentList(room) {
  if (!room) return;

  io.to(room).emit("student-list", getRoomStudents(room));
}

function getScreenSharePermission(room) {
  return roomScreenPermissions.get(room) || {
    enabled: false,
    studentId: ""
  };
}

function emitScreenSharePermission(room) {
  if (!room) return;

  io.to(room).emit("screen-share-permission", getScreenSharePermission(room));
}

function getRoomViewerSockets(room, sharerId) {
  const roomSockets = io.sockets.adapter.rooms.get(room) || new Set();

  return [...roomSockets]
    .filter((socketId) => socketId !== sharerId)
    .map((socketId) => io.sockets.sockets.get(socketId))
    .filter((roomSocket) => roomSocket?.session);
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
  const session = {
    id: sessionId,
    name: sessionName,
    role,
    room,
    teacherId: teacher?.id,
    createdAt: Date.now()
  };

  sessions.set(sessionId, session);

  res.setHeader("Set-Cookie", buildSessionCookie(session));
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

  socket.on("joinRoom", (data) => {
    if (!session) return;

    const requestedRoom = typeof data === "object" && data !== null ? data.room : data;
    const pageRole = typeof data === "object" && data !== null ? data.pageRole : "";
    const effectiveRole = pageRole === "student" && session.role === "teacher"
      ? "student"
      : session.role;
    const effectiveSession = {
      ...session,
      role: effectiveRole
    };
    const sessionRoom = sanitizeRoom(session.room || requestedRoom || "python");
    socket.join(sessionRoom);
    socket.room = sessionRoom;
    socket.session = effectiveSession;
    console.log("Joined room:", sessionRoom);

    const board = roomBoards.get(sessionRoom) || [];
    socket.emit("boardState", board);
    emitStudentList(sessionRoom);
    socket.emit("screen-share-permission", getScreenSharePermission(sessionRoom));

    const call = roomCalls.get(sessionRoom);
    if (call?.active) {
      socket.emit("voice-call-started", {
        teacherId: call.teacherId
      });
    }

    const screenShare = roomScreenShares.get(sessionRoom);
    if (screenShare?.active && screenShare.sharerId !== socket.id) {
      socket.emit("screen-share-started", {
        sharerId: screenShare.sharerId,
        name: screenShare.name,
        role: screenShare.role,
        offerIncoming: false
      });
    }
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

  socket.on("voice-call-start", () => {
    if (!socket.room) return;
    if (socket.session?.role !== "teacher") return;

    roomCalls.set(socket.room, {
      active: true,
      teacherId: socket.id
    });
    socket.to(socket.room).emit("voice-call-started", {
      teacherId: socket.id
    });
  });

  socket.on("voice-call-end", () => {
    if (!socket.room) return;
    if (socket.session?.role !== "teacher") return;

    roomCalls.delete(socket.room);
    socket.to(socket.room).emit("voice-call-ended");
  });

  socket.on("voice-call-join", () => {
    if (!socket.room || !socket.session) return;
    if (socket.session.role !== "student") return;

    const call = roomCalls.get(socket.room);
    if (!call?.active) return;

    io.to(call.teacherId).emit("voice-call-student-joined", {
      studentId: socket.id,
      name: socket.session.name
    });
  });

  socket.on("voice-signal", (data) => {
    if (!socket.room || !socket.session || !data?.targetId || !data?.signal) return;

    const targetSocket = io.sockets.sockets.get(data.targetId);
    if (!targetSocket || targetSocket.room !== socket.room) return;

    io.to(data.targetId).emit("voice-signal", {
      fromId: socket.id,
      role: socket.session.role,
      signal: data.signal
    });
  });

  socket.on("screen-share-start", () => {
    if (!socket.room || !socket.session) return;

    const permission = getScreenSharePermission(socket.room);
    const isAllowedTeacher = socket.session.role === "teacher" && permission.enabled;
    const isAllowedStudent = socket.session.role === "student" && permission.enabled && permission.studentId === socket.id;
    if (!isAllowedTeacher && !isAllowedStudent) {
      socket.emit("screen-share-not-allowed");
      return;
    }

    const currentShare = roomScreenShares.get(socket.room);
    if (currentShare?.active && currentShare.sharerId !== socket.id) {
      socket.emit("screen-share-busy", {
        name: currentShare.name
      });
      return;
    }

    roomScreenShares.set(socket.room, {
      active: true,
      sharerId: socket.id,
      name: socket.session.name,
      role: socket.session.role
    });

    getRoomViewerSockets(socket.room, socket.id).forEach((viewerSocket) => {
      viewerSocket.emit("screen-share-started", {
        sharerId: socket.id,
        name: socket.session.name,
        role: socket.session.role,
        offerIncoming: true
      });

      socket.emit("screen-share-viewer-joined", {
        viewerId: viewerSocket.id,
        name: viewerSocket.session.name,
        role: viewerSocket.session.role
      });
    });
  });

  socket.on("screen-share-permission", (data = {}) => {
    if (!socket.room || socket.session?.role !== "teacher") return;

    const enabled = Boolean(data.enabled);
    const requestedStudentId = enabled ? String(data.studentId || "") : "";
    const studentIds = new Set(getRoomStudents(socket.room).map((student) => student.id));
    const studentId = studentIds.has(requestedStudentId) ? requestedStudentId : "";

    roomScreenPermissions.set(socket.room, {
      enabled,
      studentId
    });
    emitScreenSharePermission(socket.room);
  });

  socket.on("screen-share-end", () => {
    if (!socket.room || !socket.session) return;

    const currentShare = roomScreenShares.get(socket.room);
    if (currentShare?.sharerId !== socket.id) return;

    roomScreenShares.delete(socket.room);
    socket.to(socket.room).emit("screen-share-ended");
  });

  socket.on("screen-share-watch", () => {
    if (!socket.room || !socket.session) return;

    const currentShare = roomScreenShares.get(socket.room);
    if (!currentShare?.active || currentShare.sharerId === socket.id) return;

    io.to(currentShare.sharerId).emit("screen-share-viewer-joined", {
      viewerId: socket.id,
      name: socket.session.name,
      role: socket.session.role
    });
  });

  socket.on("screen-signal", (data) => {
    if (!socket.room || !socket.session || !data?.targetId || !data?.signal) return;

    const targetSocket = io.sockets.sockets.get(data.targetId);
    if (!targetSocket || targetSocket.room !== socket.room) return;

    io.to(data.targetId).emit("screen-signal", {
      fromId: socket.id,
      role: socket.session.role,
      signal: data.signal
    });
  });

  socket.on("disconnect", () => {
    const disconnectedRoom = socket.room;

    if (socket.session?.role === "teacher" && socket.room) {
      const call = roomCalls.get(socket.room);
      if (call?.teacherId === socket.id) {
        roomCalls.delete(socket.room);
        socket.to(socket.room).emit("voice-call-ended");
      }

      roomScreenPermissions.delete(socket.room);
      socket.to(socket.room).emit("screen-share-permission", {
        enabled: false,
        studentId: ""
      });
    }

    if (socket.room) {
      const currentShare = roomScreenShares.get(socket.room);
      if (currentShare?.sharerId === socket.id) {
        roomScreenShares.delete(socket.room);
        socket.to(socket.room).emit("screen-share-ended");
      }

      const permission = roomScreenPermissions.get(socket.room);
      if (permission?.studentId === socket.id) {
        roomScreenPermissions.set(socket.room, {
          enabled: permission.enabled,
          studentId: ""
        });
        emitScreenSharePermission(socket.room);
      }
    }

    emitStudentList(disconnectedRoom);
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
