const socket = io();

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const boardTextEditor = document.getElementById("boardTextEditor");
const fontFamilyInput = document.getElementById("fontFamily");
const fontSizeInput = document.getElementById("fontSize");
const textAlignInput = document.getElementById("textAlign");
const imageInput = document.getElementById("imageInput");
const penToolButton = document.getElementById("penTool");
const textToolButton = document.getElementById("textTool");
const imageToolButton = document.getElementById("imageTool");
const boldTextButton = document.getElementById("boldText");
const italicTextButton = document.getElementById("italicText");
const underlineTextButton = document.getElementById("underlineText");

let boardEvents = [];

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  redrawBoard();
}

const params = new URLSearchParams(window.location.search);
const room = params.get("room") || "python";

const role = window.location.pathname.includes("teacher")
  ? "teacher"
  : "student";

let drawing = false;
let color = "#000";
let tool = "pen";
let lastTextPoint = { x: 0.05, y: 0.08 };
let lastBoardPoint = { x: 0.05, y: 0.08 };
let selectedImageId = null;
let imageInteraction = null;
const imageCache = new Map();
let textStyles = {
  bold: false,
  italic: false,
  underline: false
};

document.getElementById("color")?.addEventListener("change", (e) => {
  color = e.target.value;
});

window.addEventListener("resize", resizeCanvas);

updateToolbarState();
resizeCanvas();
socket.emit("joinRoom", room);

function makeDrawData(x, y, type = "move") {
  return {
    type,
    x: x / canvas.width,
    y: y / canvas.height,
    color
  };
}

function sendDrawData(data) {
  recordBoardEvent(data);

  if (data.kind === "image") {
    redrawBoard();
  } else {
    drawLine(data);
  }

  socket.emit("draw", data);
}

// Mouse
canvas.addEventListener("mousedown", (e) => {
  if (role !== "teacher") return;

  if (tool === "text") {
    setBoardPoint(e.offsetX, e.offsetY);
    setTextPoint(e.offsetX, e.offsetY);
    openTextEditor();
    return;
  }

  if (tool === "image") {
    setBoardPoint(e.offsetX, e.offsetY);
    const image = findImageAt(e.offsetX, e.offsetY);

    if (image) {
      selectedImageId = image.id;
      imageInteraction = {
        mode: isOnImageResizeHandle(image, e.offsetX, e.offsetY) ? "resize" : "move",
        startX: e.offsetX / canvas.width,
        startY: e.offsetY / canvas.height,
        original: { ...image }
      };
    } else {
      selectedImageId = null;
    }

    redrawBoard();
    return;
  }

  setBoardPoint(e.offsetX, e.offsetY);
  drawing = true;
  sendDrawData(makeDrawData(e.offsetX, e.offsetY, "start"));
});
canvas.addEventListener("mouseup", stopDrawing);
canvas.addEventListener("mouseleave", () => {
  stopDrawing();
  stopImageInteraction();
});
canvas.addEventListener("mousemove", draw);

// Touch
canvas.addEventListener("touchstart", (e) => {
  if (role !== "teacher") return;

  e.preventDefault();
  const point = getTouchPoint(e);

  if (tool === "text") {
    setBoardPoint(point.x, point.y);
    setTextPoint(point.x, point.y);
    openTextEditor();
    return;
  }

  if (tool === "image") {
    setBoardPoint(point.x, point.y);
    const image = findImageAt(point.x, point.y);

    if (image) {
      selectedImageId = image.id;
      imageInteraction = {
        mode: isOnImageResizeHandle(image, point.x, point.y) ? "resize" : "move",
        startX: point.x / canvas.width,
        startY: point.y / canvas.height,
        original: { ...image }
      };
    } else {
      selectedImageId = null;
    }

    redrawBoard();
    return;
  }

  setBoardPoint(point.x, point.y);
  drawing = true;

  sendDrawData(makeDrawData(point.x, point.y, "start"));
});
canvas.addEventListener("touchend", stopDrawing);
canvas.addEventListener("touchmove", touchDraw);

function draw(e) {
  if (role !== "teacher") return;

  if (tool === "image" && imageInteraction) {
    updateSelectedImage(e.offsetX, e.offsetY);
    return;
  }

  if (tool !== "pen") return;
  if (!drawing) return;

  sendDrawData(makeDrawData(e.offsetX, e.offsetY));
}

function getTouchPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const touch = e.touches[0];

  return {
    x: touch.clientX - rect.left,
    y: touch.clientY - rect.top
  };
}

function touchDraw(e) {
  if (role !== "teacher") return;

  if (tool === "image" && imageInteraction) {
    e.preventDefault();
    const point = getTouchPoint(e);
    updateSelectedImage(point.x, point.y);
    return;
  }

  if (tool !== "pen") return;
  if (!drawing) return;

  e.preventDefault();

  const point = getTouchPoint(e);
  sendDrawData(makeDrawData(point.x, point.y));
}

function stopDrawing() {
  stopImageInteraction();

  if (role !== "teacher" || !drawing) return;

  drawing = false;
  sendDrawData({ type: "end" });
}

function drawLine(data) {
  if (data.kind === "text") {
    drawText(data);
    return;
  }

  if (data.kind === "image") {
    drawImage(data);
    return;
  }

  if (data.type === "end") {
    ctx.beginPath();
    return;
  }

  const x = data.x * canvas.width;
  const y = data.y * canvas.height;

  ctx.strokeStyle = data.color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";

  if (data.type === "start") {
    ctx.beginPath();
    ctx.moveTo(x, y);
    return;
  }

  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y);
}

function drawText(data) {
  const x = data.x * canvas.width;
  const y = data.y * canvas.height;
  const fontSize = data.fontSize * canvas.height;
  const weight = data.bold ? "700" : "400";
  const style = data.italic ? "italic" : "normal";
  const fontFamily = formatFontFamily(data.fontFamily);
  const lines = data.text.split("\n");
  const lineHeight = fontSize * 1.25;

  ctx.fillStyle = data.color;
  ctx.strokeStyle = data.color;
  ctx.textAlign = data.align;
  ctx.textBaseline = "top";
  ctx.font = `${style} ${weight} ${fontSize}px ${fontFamily}`;

  lines.forEach((line, index) => {
    const lineY = y + index * lineHeight;
    ctx.fillText(line, x, lineY);

    if (data.underline) {
      drawUnderline(line, x, lineY + fontSize + 2);
    }
  });

  ctx.beginPath();
}

function drawUnderline(text, x, y) {
  const width = ctx.measureText(text).width;
  let startX = x;

  if (ctx.textAlign === "center") {
    startX = x - width / 2;
  } else if (ctx.textAlign === "right") {
    startX = x - width;
  }

  ctx.beginPath();
  ctx.moveTo(startX, y);
  ctx.lineTo(startX + width, y);
  ctx.stroke();
}

function recordBoardEvent(data) {
  if (data.kind === "image" && data.id) {
    const existingIndex = boardEvents.findIndex((event) => event.kind === "image" && event.id === data.id);

    if (existingIndex >= 0) {
      boardEvents[existingIndex] = data;
      return;
    }
  }

  boardEvents.push(data);
}

function drawImage(data) {
  const cachedImage = imageCache.get(data.src);

  if (cachedImage?.complete) {
    paintImage(cachedImage, data);
    return;
  }

  const image = cachedImage || new Image();
  image.onload = () => {
    imageCache.set(data.src, image);
    paintImage(image, data);
  };

  if (!cachedImage) {
    image.src = data.src;
  }
}

function paintImage(image, data) {
  const x = data.x * canvas.width;
  const y = data.y * canvas.height;
  const width = data.width * canvas.width;
  const height = data.height * canvas.height;

  ctx.drawImage(image, x, y, width, height);
  ctx.beginPath();

  if (role === "teacher" && selectedImageId === data.id) {
    drawImageSelection(data);
  }
}

function drawImageSelection(data) {
  const x = data.x * canvas.width;
  const y = data.y * canvas.height;
  const width = data.width * canvas.width;
  const height = data.height * canvas.height;
  const handleSize = getImageHandleSize();

  ctx.save();
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, width, height);
  ctx.setLineDash([]);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#2563eb";
  ctx.fillRect(x + width - handleSize / 2, y + height - handleSize / 2, handleSize, handleSize);
  ctx.strokeRect(x + width - handleSize / 2, y + height - handleSize / 2, handleSize, handleSize);
  ctx.restore();
}

function drawSelectedImageOutline() {
  if (role !== "teacher" || !selectedImageId) return;

  const selectedImage = boardEvents.find((event) => event.kind === "image" && event.id === selectedImageId);
  if (selectedImage) {
    drawImageSelection(selectedImage);
  }
}

function redrawBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const events = [...boardEvents];
  events.forEach(drawLine);
  drawSelectedImageOutline();
}

socket.on("draw", (data) => {
  recordBoardEvent(data);
  if (data.kind === "image") {
    redrawBoard();
  } else {
    drawLine(data);
  }
});

function clearBoard() {
  boardEvents = [];
  selectedImageId = null;
  imageInteraction = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  socket.emit("clear");
}

socket.on("clear", () => {
  boardEvents = [];
  selectedImageId = null;
  imageInteraction = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

function saveBoard() {
  const link = document.createElement("a");
  link.download = "whiteboard.png";
  link.href = canvas.toDataURL();
  link.click();
}

function setTextPoint(x, y) {
  lastTextPoint = {
    x: x / canvas.width,
    y: y / canvas.height
  };
}

function setBoardPoint(x, y) {
  lastBoardPoint = {
    x: x / canvas.width,
    y: y / canvas.height
  };
}

function placeText(x, y, text = boardTextEditor?.value) {
  setTextPoint(x, y);
  placeTextAtLastPoint(text);
}

function placeTextAtLastPoint(text = boardTextEditor?.value) {
  if (!text?.trim()) return;

  const data = {
    kind: "text",
    text,
    x: lastTextPoint.x,
    y: lastTextPoint.y,
    color,
    fontFamily: fontFamilyInput?.value || "Arial",
    fontSize: Number(fontSizeInput?.value || 28) / canvas.height,
    align: textAlignInput?.value || "left",
    bold: textStyles.bold,
    italic: textStyles.italic,
    underline: textStyles.underline
  };

  sendDrawData(data);
}

function formatFontFamily(fontFamily) {
  if (!fontFamily) return "Arial";
  return fontFamily.includes(" ") ? `"${fontFamily}"` : fontFamily;
}

window.setTool = function (nextTool) {
  tool = nextTool;
  updateToolbarState();
};

window.toggleTextStyle = function (style) {
  textStyles[style] = !textStyles[style];
  updateToolbarState();
};

window.pasteText = async function () {
  if (role !== "teacher") return;

  setTool("text");
  openTextEditor();
};

boardTextEditor?.addEventListener("paste", () => {
  if (role !== "teacher") return;

  setTool("text");

  setTimeout(() => {
    commitTextEditor();
  }, 0);
});

boardTextEditor?.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    commitTextEditor();
  }

  if (e.key === "Escape") {
    e.preventDefault();
    closeTextEditor();
  }
});

window.addEventListener("paste", (e) => {
  if (role !== "teacher") return;
  if (document.activeElement === boardTextEditor) return;

  const imageFile = getPastedImageFile(e);
  if (imageFile) {
    e.preventDefault();
    setTool("image");
    placeImageFile(imageFile);
    return;
  }

  if (tool !== "text") return;

  const text = e.clipboardData?.getData("text");
  if (!text?.trim()) return;

  e.preventDefault();
  openTextEditor(text);
  commitTextEditor();
});

window.addTextToBoard = function () {
  if (role !== "teacher") return;

  setTool("text");
  if (boardTextEditor?.style.display === "block") {
    commitTextEditor();
  } else {
    openTextEditor();
  }
};

window.chooseImage = function () {
  if (role !== "teacher") return;

  setTool("image");
  imageInput?.click();
};

imageInput?.addEventListener("change", () => {
  const file = imageInput.files?.[0];
  if (file) {
    placeImageFile(file);
  }
  imageInput.value = "";
});

function getPastedImageFile(e) {
  const items = [...(e.clipboardData?.items || [])];
  const imageItem = items.find((item) => item.type.startsWith("image/"));
  return imageItem?.getAsFile() || null;
}

function placeImageFile(file) {
  if (!file.type.startsWith("image/")) return;

  const reader = new FileReader();
  reader.onload = () => prepareImageForBoard(reader.result);
  reader.readAsDataURL(file);
}

function prepareImageForBoard(src) {
  const image = new Image();
  image.onload = () => {
    const prepared = resizeImageForSync(image);
    placeImage(prepared.src, prepared.width, prepared.height);
  };
  image.src = src;
}

function resizeImageForSync(image) {
  const maxSourceSize = 1200;
  const scale = Math.min(maxSourceSize / image.width, maxSourceSize / image.height, 1);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const scratchCanvas = document.createElement("canvas");
  const scratchCtx = scratchCanvas.getContext("2d");

  scratchCanvas.width = width;
  scratchCanvas.height = height;
  scratchCtx.drawImage(image, 0, 0, width, height);

  return {
    src: scratchCanvas.toDataURL("image/jpeg", 0.82),
    width,
    height
  };
}

function placeImage(src, sourceWidth, sourceHeight) {
  const maxWidth = canvas.width * 0.35;
  const maxHeight = canvas.height * 0.35;
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  const id = createImageId();
  selectedImageId = id;

  sendDrawData({
    kind: "image",
    id,
    src,
    x: lastBoardPoint.x,
    y: lastBoardPoint.y,
    width: width / canvas.width,
    height: height / canvas.height
  });
}

function findImageAt(x, y) {
  const pointX = x / canvas.width;
  const pointY = y / canvas.height;

  for (let index = boardEvents.length - 1; index >= 0; index -= 1) {
    const event = boardEvents[index];

    if (event.kind !== "image") continue;

    const isInsideX = pointX >= event.x && pointX <= event.x + event.width;
    const isInsideY = pointY >= event.y && pointY <= event.y + event.height;

    if (isInsideX && isInsideY) return event;
  }

  return null;
}

function isOnImageResizeHandle(image, x, y) {
  const handleSize = getImageHandleSize();
  const imageRight = (image.x + image.width) * canvas.width;
  const imageBottom = (image.y + image.height) * canvas.height;

  return Math.abs(x - imageRight) <= handleSize && Math.abs(y - imageBottom) <= handleSize;
}

function getImageHandleSize() {
  return 14;
}

function updateSelectedImage(x, y) {
  if (!imageInteraction?.original) return;

  const pointerX = x / canvas.width;
  const pointerY = y / canvas.height;
  const deltaX = pointerX - imageInteraction.startX;
  const deltaY = pointerY - imageInteraction.startY;
  const original = imageInteraction.original;
  const nextImage = { ...original };

  if (imageInteraction.mode === "move") {
    nextImage.x = clamp(original.x + deltaX, 0, 1 - original.width);
    nextImage.y = clamp(original.y + deltaY, 0, 1 - original.height);
  } else {
    const minWidth = 0.04;
    const minHeight = 0.04;
    const horizontalScale = (pointerX - original.x) / original.width;
    const verticalScale = (pointerY - original.y) / original.height;
    const scale = Math.max(horizontalScale, verticalScale, minWidth / original.width, minHeight / original.height);

    nextImage.width = Math.min(original.width * scale, 1 - original.x);
    nextImage.height = Math.min(original.height * scale, 1 - original.y);
  }

  recordBoardEvent(nextImage);
  socket.emit("draw", nextImage);
  redrawBoard();
}

function stopImageInteraction() {
  imageInteraction = null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createImageId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `image-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openTextEditor(text = "") {
  if (!boardTextEditor) return;

  const canvasRect = canvas.getBoundingClientRect();
  const mainRect = document.getElementById("main").getBoundingClientRect();
  const x = lastTextPoint.x * canvas.width;
  const y = lastTextPoint.y * canvas.height;

  boardTextEditor.value = text;
  boardTextEditor.style.left = `${canvasRect.left - mainRect.left + x}px`;
  boardTextEditor.style.top = `${canvasRect.top - mainRect.top + y}px`;
  boardTextEditor.style.color = color;
  boardTextEditor.style.fontFamily = fontFamilyInput?.value || "Arial";
  boardTextEditor.style.fontSize = `${Number(fontSizeInput?.value || 28)}px`;
  boardTextEditor.style.fontWeight = textStyles.bold ? "700" : "400";
  boardTextEditor.style.fontStyle = textStyles.italic ? "italic" : "normal";
  boardTextEditor.style.textDecoration = textStyles.underline ? "underline" : "none";
  boardTextEditor.style.textAlign = textAlignInput?.value || "left";
  boardTextEditor.style.display = "block";
  boardTextEditor.focus();
}

function commitTextEditor() {
  if (!boardTextEditor?.value.trim()) {
    closeTextEditor();
    return;
  }

  placeTextAtLastPoint(boardTextEditor.value);
  closeTextEditor();
}

function closeTextEditor() {
  if (!boardTextEditor) return;

  boardTextEditor.value = "";
  boardTextEditor.style.display = "none";
}

function updateToolbarState() {
  penToolButton?.classList.toggle("active", tool === "pen");
  textToolButton?.classList.toggle("active", tool === "text");
  imageToolButton?.classList.toggle("active", tool === "image");
  boldTextButton?.classList.toggle("active", textStyles.bold);
  italicTextButton?.classList.toggle("active", textStyles.italic);
  underlineTextButton?.classList.toggle("active", textStyles.underline);
}
