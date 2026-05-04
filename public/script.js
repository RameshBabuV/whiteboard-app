const socket = io();

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight - 220;

const params = new URLSearchParams(window.location.search);
const room = params.get("room") || "default";

const role = window.location.pathname.includes("teacher")
  ? "teacher"
  : "student";

socket.emit("joinRoom", room);

let drawing = false;
let color = "#000";

document.getElementById("color")?.addEventListener("change", (e) => {
  color = e.target.value;
});

// Mouse
canvas.addEventListener("mousedown", () => drawing = true);
canvas.addEventListener("mouseup", () => {
  drawing = false;
  ctx.beginPath();
});
canvas.addEventListener("mousemove", draw);

// Touch
canvas.addEventListener("touchstart", () => drawing = true);
canvas.addEventListener("touchend", () => {
  drawing = false;
  ctx.beginPath();
});
canvas.addEventListener("touchmove", touchDraw);

function draw(e) {
  if (role !== "teacher") return;
  if (!drawing) return;

  const data = { x: e.offsetX, y: e.offsetY, color };

  drawLine(data);
  socket.emit("draw", data);
}

function touchDraw(e) {
  if (role !== "teacher") return;
  if (!drawing) return;

  const rect = canvas.getBoundingClientRect();
  const touch = e.touches[0];

  const data = {
    x: touch.clientX - rect.left,
    y: touch.clientY - rect.top,
    color
  };

  drawLine(data);
  socket.emit("draw", data);
}

function drawLine(data) {
  ctx.strokeStyle = data.color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";

  ctx.lineTo(data.x, data.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(data.x, data.y);
}

socket.on("draw", drawLine);

function clearBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  socket.emit("clear");
}

socket.on("clear", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

function saveBoard() {
  const link = document.createElement("a");
  link.download = "whiteboard.png";
  link.href = canvas.toDataURL();
  link.click();
}