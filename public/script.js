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
const tableToolButton = document.getElementById("tableTool");
const rectangleToolButton = document.getElementById("rectangleTool");
const circleToolButton = document.getElementById("circleTool");
const triangleToolButton = document.getElementById("triangleTool");
const boldTextButton = document.getElementById("boldText");
const italicTextButton = document.getElementById("italicText");
const underlineTextButton = document.getElementById("underlineText");
const undoBoardButton = document.getElementById("undoBoard");
const redoBoardButton = document.getElementById("redoBoard");
const tableRowsInput = document.getElementById("tableRows");
const tableColsInput = document.getElementById("tableCols");

let boardEvents = [];
let undoStack = [];
let redoStack = [];
const maxHistoryItems = 50;

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
let shapeType = "rectangle";
let shapeInteraction = null;
let selectedBoardObjectId = null;
let boardObjectInteraction = null;
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

  if (isReplaceableBoardObject(data)) {
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
    commitOpenTextEditor();
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
        original: { ...image },
        historyRecorded: false
      };
    } else {
      selectedImageId = null;
    }

    redrawBoard();
    return;
  }

  if (tool === "table") {
    commitOpenTextEditor();
    setBoardPoint(e.offsetX, e.offsetY);
    const table = findBoardObjectAt(e.offsetX, e.offsetY, (event) => event.kind === "table");

    if (table) {
      startBoardObjectMove(table, e.offsetX, e.offsetY);
      return;
    }

    placeTableAtLastPoint();
    setTool("pen");
    return;
  }

  if (tool === "shape") {
    commitOpenTextEditor();
    const shape = findBoardObjectAt(e.offsetX, e.offsetY, (event) => event.kind === "shape");

    if (shape) {
      startBoardObjectMove(shape, e.offsetX, e.offsetY);
      return;
    }

    startShape(e.offsetX, e.offsetY);
    return;
  }

  commitOpenTextEditor();
  setBoardPoint(e.offsetX, e.offsetY);
  drawing = true;
  pushUndoSnapshot();
  sendDrawData(makeDrawData(e.offsetX, e.offsetY, "start"));
});
canvas.addEventListener("mouseup", stopDrawing);
canvas.addEventListener("mouseleave", () => {
  stopDrawing();
  stopImageInteraction();
  stopShapeInteraction(false);
});
canvas.addEventListener("mousemove", draw);

// Touch
canvas.addEventListener("touchstart", (e) => {
  if (role !== "teacher") return;

  e.preventDefault();
  const point = getTouchPoint(e);

  if (tool === "text") {
    commitOpenTextEditor();
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
        original: { ...image },
        historyRecorded: false
      };
    } else {
      selectedImageId = null;
    }

    redrawBoard();
    return;
  }

  if (tool === "table") {
    commitOpenTextEditor();
    setBoardPoint(point.x, point.y);
    const table = findBoardObjectAt(point.x, point.y, (event) => event.kind === "table");

    if (table) {
      startBoardObjectMove(table, point.x, point.y);
      return;
    }

    placeTableAtLastPoint();
    setTool("pen");
    return;
  }

  if (tool === "shape") {
    commitOpenTextEditor();
    const shape = findBoardObjectAt(point.x, point.y, (event) => event.kind === "shape");

    if (shape) {
      startBoardObjectMove(shape, point.x, point.y);
      return;
    }

    startShape(point.x, point.y);
    return;
  }

  commitOpenTextEditor();
  setBoardPoint(point.x, point.y);
  drawing = true;

  pushUndoSnapshot();
  sendDrawData(makeDrawData(point.x, point.y, "start"));
});
canvas.addEventListener("touchend", () => {
  stopDrawing();
  stopShapeInteraction(true);
});
canvas.addEventListener("touchmove", touchDraw);

function draw(e) {
  if (role !== "teacher") return;

  setBoardPoint(e.offsetX, e.offsetY);

  if (tool === "image" && imageInteraction) {
    updateSelectedImage(e.offsetX, e.offsetY);
    return;
  }

  if (tool === "shape" && shapeInteraction) {
    updateShapePreview(e.offsetX, e.offsetY);
    return;
  }

  if (boardObjectInteraction) {
    updateBoardObjectMove(e.offsetX, e.offsetY);
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

  if (tool === "shape" && shapeInteraction) {
    e.preventDefault();
    const point = getTouchPoint(e);
    updateShapePreview(point.x, point.y);
    return;
  }

  if (boardObjectInteraction) {
    e.preventDefault();
    const point = getTouchPoint(e);
    updateBoardObjectMove(point.x, point.y);
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
  stopBoardObjectMove();

  if (tool === "shape" && shapeInteraction) {
    stopShapeInteraction(true);
    return;
  }

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

  if (data.kind === "table") {
    drawTable(data);
    return;
  }

  if (data.kind === "shape") {
    drawShape(data);
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

function drawTable(data) {
  const x = data.x * canvas.width;
  const y = data.y * canvas.height;
  const width = data.width * canvas.width;
  const height = data.height * canvas.height;
  const rows = Math.max(1, Number(data.rows) || 1);
  const cols = Math.max(1, Number(data.cols) || 1);
  const cellWidth = width / cols;
  const cellHeight = height / rows;

  ctx.save();
  ctx.strokeStyle = data.color || "#000000";
  ctx.lineWidth = data.lineWidth || 2;

  for (let row = 0; row <= rows; row += 1) {
    const lineY = y + row * cellHeight;
    ctx.beginPath();
    ctx.moveTo(x, lineY);
    ctx.lineTo(x + width, lineY);
    ctx.stroke();
  }

  for (let col = 0; col <= cols; col += 1) {
    const lineX = x + col * cellWidth;
    ctx.beginPath();
    ctx.moveTo(lineX, y);
    ctx.lineTo(lineX, y + height);
    ctx.stroke();
  }

  ctx.restore();
  ctx.beginPath();
}

function drawShape(data) {
  const x = data.x * canvas.width;
  const y = data.y * canvas.height;
  const width = data.width * canvas.width;
  const height = data.height * canvas.height;

  ctx.save();
  ctx.strokeStyle = data.color || "#000000";
  ctx.lineWidth = data.lineWidth || 3;
  ctx.lineJoin = "round";

  if (data.shape === "circle") {
    ctx.beginPath();
    ctx.ellipse(x + width / 2, y + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (data.shape === "triangle") {
    ctx.beginPath();
    ctx.moveTo(x + width / 2, y);
    ctx.lineTo(x + width, y + height);
    ctx.lineTo(x, y + height);
    ctx.closePath();
    ctx.stroke();
  } else {
    ctx.strokeRect(x, y, width, height);
  }

  ctx.restore();
  ctx.beginPath();
}

function recordBoardEvent(data) {
  if (isReplaceableBoardObject(data)) {
    const existingIndex = boardEvents.findIndex((event) => event.id === data.id);

    if (existingIndex >= 0) {
      boardEvents[existingIndex] = data;
      return;
    }
  }

  boardEvents.push(data);
}

function isReplaceableBoardObject(data) {
  return ["image", "table", "shape"].includes(data.kind) && data.id;
}

function cloneBoardEvents(events = boardEvents) {
  return JSON.parse(JSON.stringify(events));
}

function pushUndoSnapshot() {
  if (role !== "teacher") return;

  undoStack.push(cloneBoardEvents());

  if (undoStack.length > maxHistoryItems) {
    undoStack.shift();
  }

  redoStack = [];
  updateHistoryButtons();
}

function applyBoardSnapshot(events) {
  boardEvents = cloneBoardEvents(events);
  selectedImageId = null;
  selectedBoardObjectId = null;
  imageInteraction = null;
  boardObjectInteraction = null;
  redrawBoard();
  socket.emit("boardState", boardEvents);
  updateHistoryButtons();
}

window.undoBoard = function () {
  if (role !== "teacher" || undoStack.length === 0) return;

  redoStack.push(cloneBoardEvents());
  applyBoardSnapshot(undoStack.pop());
};

window.redoBoard = function () {
  if (role !== "teacher" || redoStack.length === 0) return;

  undoStack.push(cloneBoardEvents());
  applyBoardSnapshot(redoStack.pop());
};

function drawImage(data) {
  const cachedImage = imageCache.get(data.src);

  if (cachedImage?.complete) {
    paintImage(cachedImage, data);
    return;
  }

  const image = cachedImage || new Image();
  image.onload = () => {
    imageCache.set(data.src, image);
    redrawBoard();
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
  drawSelectedBoardObjectOutline();
  drawSelectedImageOutline();
}

socket.on("draw", (data) => {
  recordBoardEvent(data);
  if (data.kind === "image") {
    redrawBoard();
  } else {
    drawLine(data);
  }
  updateHistoryButtons();
});

socket.on("boardState", (events) => {
  boardEvents = cloneBoardEvents(events || []);
  selectedImageId = null;
  selectedBoardObjectId = null;
  imageInteraction = null;
  boardObjectInteraction = null;
  redrawBoard();
  updateHistoryButtons();
});

function clearBoard() {
  if (role !== "teacher") return;

  pushUndoSnapshot();
  boardEvents = [];
  selectedImageId = null;
  selectedBoardObjectId = null;
  imageInteraction = null;
  boardObjectInteraction = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  socket.emit("clear");
  updateHistoryButtons();
}

socket.on("clear", () => {
  boardEvents = [];
  selectedImageId = null;
  selectedBoardObjectId = null;
  imageInteraction = null;
  boardObjectInteraction = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  undoStack = [];
  redoStack = [];
  updateHistoryButtons();
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

  pushUndoSnapshot();
  sendDrawData(data);
}

function formatFontFamily(fontFamily) {
  if (!fontFamily) return "Arial";
  return fontFamily.includes(" ") ? `"${fontFamily}"` : fontFamily;
}

window.setTool = function (nextTool) {
  if (tool === "text" && nextTool !== "text") {
    commitOpenTextEditor();
  }

  stopShapeInteraction(false);
  tool = nextTool;
  updateToolbarState();
};

window.setShapeTool = function (nextShapeType) {
  if (role !== "teacher") return;

  commitOpenTextEditor();
  stopShapeInteraction(false);
  shapeType = nextShapeType;
  tool = "shape";
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

  const text = e.clipboardData?.getData("text");
  if (!text?.trim()) return;

  e.preventDefault();
  setTool("text");
  placeTextAtLastPoint(text);
});

window.addEventListener("keydown", (e) => {
  if (role !== "teacher") return;
  if (document.activeElement === boardTextEditor) return;
  if (!e.metaKey && !e.ctrlKey) return;

  const key = e.key.toLowerCase();

  if (key === "z" && !e.shiftKey) {
    e.preventDefault();
    window.undoBoard();
  } else if ((key === "z" && e.shiftKey) || key === "y") {
    e.preventDefault();
    window.redoBoard();
  }
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

window.addTableToBoard = function () {
  if (role !== "teacher") return;

  commitOpenTextEditor();
  setTool("table");
  placeTableAtLastPoint();
  setTool("pen");
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

  if (imageItem) {
    return imageItem.getAsFile();
  }

  const files = [...(e.clipboardData?.files || [])];
  return files.find((file) => file.type.startsWith("image/")) || null;
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

  pushUndoSnapshot();
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

function placeTableAtLastPoint() {
  const rows = clampInteger(tableRowsInput?.value, 1, 20, 3);
  const cols = clampInteger(tableColsInput?.value, 1, 20, 3);
  const width = Math.min(0.6, 0.12 * cols);
  const height = Math.min(0.5, 0.08 * rows);
  const x = clamp(lastBoardPoint.x, 0, Math.max(0, 1 - width));
  const y = clamp(lastBoardPoint.y, 0, Math.max(0, 1 - height));

  pushUndoSnapshot();
  sendDrawData({
    kind: "table",
    id: createBoardObjectId("table"),
    rows,
    cols,
    x,
    y,
    width,
    height,
    color,
    lineWidth: 2
  });
}

function startShape(x, y) {
  setBoardPoint(x, y);
  shapeInteraction = {
    startX: x / canvas.width,
    startY: y / canvas.height,
    currentX: x / canvas.width,
    currentY: y / canvas.height
  };
  redrawBoard();
}

function updateShapePreview(x, y) {
  if (!shapeInteraction) return;

  shapeInteraction.currentX = x / canvas.width;
  shapeInteraction.currentY = y / canvas.height;
  redrawBoard();
  drawShape(makeShapeData(shapeInteraction));
}

function stopShapeInteraction(commit) {
  if (!shapeInteraction) return;

  const data = makeShapeData(shapeInteraction);
  shapeInteraction = null;

  if (!commit || data.width < 0.005 || data.height < 0.005) {
    redrawBoard();
    return;
  }

  pushUndoSnapshot();
  sendDrawData(data);
}

function makeShapeData(interaction) {
  const x = Math.min(interaction.startX, interaction.currentX);
  const y = Math.min(interaction.startY, interaction.currentY);
  const width = Math.abs(interaction.currentX - interaction.startX);
  const height = Math.abs(interaction.currentY - interaction.startY);

  return {
    kind: "shape",
    id: createBoardObjectId("shape"),
    shape: shapeType,
    x,
    y,
    width,
    height,
    color,
    lineWidth: 3
  };
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

function findBoardObjectAt(x, y, predicate) {
  const pointX = x / canvas.width;
  const pointY = y / canvas.height;

  for (let index = boardEvents.length - 1; index >= 0; index -= 1) {
    const event = boardEvents[index];

    if (!predicate(event)) continue;

    const isInsideX = pointX >= event.x && pointX <= event.x + event.width;
    const isInsideY = pointY >= event.y && pointY <= event.y + event.height;

    if (isInsideX && isInsideY) return event;
  }

  return null;
}

function startBoardObjectMove(object, x, y) {
  if (!object.id) {
    object.id = createBoardObjectId(object.kind);
    recordBoardEvent(object);
  }

  selectedImageId = null;
  selectedBoardObjectId = object.id;
  boardObjectInteraction = {
    startX: x / canvas.width,
    startY: y / canvas.height,
    original: { ...object },
    historyRecorded: false
  };
  redrawBoard();
}

function updateBoardObjectMove(x, y) {
  if (!boardObjectInteraction?.original) return;

  if (!boardObjectInteraction.historyRecorded) {
    pushUndoSnapshot();
    boardObjectInteraction.historyRecorded = true;
  }

  const pointerX = x / canvas.width;
  const pointerY = y / canvas.height;
  const deltaX = pointerX - boardObjectInteraction.startX;
  const deltaY = pointerY - boardObjectInteraction.startY;
  const original = boardObjectInteraction.original;
  const nextObject = {
    ...original,
    x: clamp(original.x + deltaX, 0, 1 - original.width),
    y: clamp(original.y + deltaY, 0, 1 - original.height)
  };

  recordBoardEvent(nextObject);
  socket.emit("draw", nextObject);
  redrawBoard();
}

function stopBoardObjectMove() {
  boardObjectInteraction = null;
}

function drawSelectedBoardObjectOutline() {
  if (role !== "teacher" || !selectedBoardObjectId) return;

  const selectedObject = boardEvents.find((event) => event.id === selectedBoardObjectId);
  if (!selectedObject) return;

  const x = selectedObject.x * canvas.width;
  const y = selectedObject.y * canvas.height;
  const width = selectedObject.width * canvas.width;
  const height = selectedObject.height * canvas.height;

  ctx.save();
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
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

  if (!imageInteraction.historyRecorded) {
    pushUndoSnapshot();
    imageInteraction.historyRecorded = true;
  }

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

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) return fallback;
  return clamp(number, min, max);
}

function createImageId() {
  return createBoardObjectId("image");
}

function createBoardObjectId(prefix) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  ctx.beginPath();
}

function commitOpenTextEditor() {
  if (boardTextEditor?.style.display === "block") {
    commitTextEditor();
  }
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
  tableToolButton?.classList.toggle("active", tool === "table");
  rectangleToolButton?.classList.toggle("active", tool === "shape" && shapeType === "rectangle");
  circleToolButton?.classList.toggle("active", tool === "shape" && shapeType === "circle");
  triangleToolButton?.classList.toggle("active", tool === "shape" && shapeType === "triangle");
  boldTextButton?.classList.toggle("active", textStyles.bold);
  italicTextButton?.classList.toggle("active", textStyles.italic);
  underlineTextButton?.classList.toggle("active", textStyles.underline);
  updateHistoryButtons();
}

function updateHistoryButtons() {
  if (undoBoardButton) {
    undoBoardButton.disabled = role !== "teacher" || undoStack.length === 0;
  }

  if (redoBoardButton) {
    redoBoardButton.disabled = role !== "teacher" || redoStack.length === 0;
  }
}
