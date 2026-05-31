const socket = io();

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const boardResizeHandle = document.getElementById("boardResizeHandle");
const boardTextEditor = document.getElementById("boardTextEditor");
const fontFamilyInput = document.getElementById("fontFamily");
const fontSizeInput = document.getElementById("fontSize");
const textAlignInput = document.getElementById("textAlign");
const imageInput = document.getElementById("imageInput");
const backgroundColorInput = document.getElementById("backgroundColor");
const toolSelect = document.getElementById("toolSelect");
const selectToolButton = document.getElementById("selectTool");
const penToolButton = document.getElementById("penTool");
const eraserToolButton = document.getElementById("eraserTool");
const fillToolButton = document.getElementById("fillTool");
const textToolButton = document.getElementById("textTool");
const imageToolButton = document.getElementById("imageTool");
const tableToolButton = document.getElementById("tableTool");
const rectangleToolButton = document.getElementById("rectangleTool");
const circleToolButton = document.getElementById("circleTool");
const triangleToolButton = document.getElementById("triangleTool");
const lineToolButton = document.getElementById("lineTool");
const diamondToolButton = document.getElementById("diamondTool");
const pentagonToolButton = document.getElementById("pentagonTool");
const hexagonToolButton = document.getElementById("hexagonTool");
const starToolButton = document.getElementById("starTool");
const arrowToolButton = document.getElementById("arrowTool");
const parallelogramToolButton = document.getElementById("parallelogramTool");
const boldTextButton = document.getElementById("boldText");
const italicTextButton = document.getElementById("italicText");
const underlineTextButton = document.getElementById("underlineText");
const undoBoardButton = document.getElementById("undoBoard");
const redoBoardButton = document.getElementById("redoBoard");
const tableRowsInput = document.getElementById("tableRows");
const tableColsInput = document.getElementById("tableCols");
const startCallButton = document.getElementById("startCall");
const endCallButton = document.getElementById("endCall");
const studentCallBar = document.getElementById("studentCallBar");
const studentTopBar = document.getElementById("studentTopBar");
const studentMuteToggleButton = document.getElementById("studentMuteToggle");
const callStatus = document.getElementById("callStatus");
const screenShareToggle = document.getElementById("screenShareToggle");
const studentPicker = document.getElementById("studentPicker");
const studentPickerSummary = document.getElementById("studentPickerSummary");
const studentRadioList = document.getElementById("studentRadioList");
const shareScreenButton = document.getElementById("shareScreen");
const stopScreenShareButton = document.getElementById("stopScreenShare");
const screenShareStatus = document.getElementById("screenShareStatus");
const screenShareVideo = document.getElementById("screenShareVideo");

let boardEvents = [];
let undoStack = [];
let redoStack = [];
const maxHistoryItems = 50;
const params = new URLSearchParams(window.location.search);
const room = params.get("room") || "python";

const role = window.location.pathname.includes("teacher")
  ? "teacher"
  : "student";
const voicePeerConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  redrawBoard();
}

function applySavedBoardHeight() {
  const savedHeight = Number(localStorage.getItem(getBoardHeightStorageKey()));
  if (!Number.isFinite(savedHeight) || savedHeight <= 0) return;

  const bounds = getBoardHeightBounds();
  setBoardDisplayHeight(clamp(savedHeight, bounds.min, bounds.max));
}

function getBoardHeightStorageKey() {
  return `whiteboard:${role}:${room}:boardHeight`;
}

let drawing = false;
let currentStrokeId = null;
let color = "#000";
let backgroundColor = "#ffffff";
let tool = "pen";
let lastTextPoint = { x: 0.05, y: 0.08 };
let lastBoardPoint = { x: 0.05, y: 0.08 };
let selectedImageId = null;
let imageInteraction = null;
let shapeType = "rectangle";
let shapeInteraction = null;
let selectedBoardObjectId = null;
let boardObjectInteraction = null;
let moveMode = false;
let boardResizeInteraction = null;
let voiceCallActive = false;
let localVoiceStream = null;
let teacherSocketId = null;
let studentVoicePeer = null;
let studentVoiceJoined = false;
let studentMuted = true;
let screenShareActive = false;
let localScreenStream = null;
let screenSharerId = null;
let screenSharePermissionEnabled = false;
let screenShareAllowed = false;
let selectedScreenShareStudentId = "";
let connectedStudents = [];
let screenViewerPeer = null;
const screenSharePeers = new Map();
const pendingScreenCandidates = new Map();
const teacherVoicePeers = new Map();
const remoteVoiceAudios = new Map();
const pendingVoiceCandidates = new Map();
const imageCache = new Map();
let textStyles = {
  bold: false,
  italic: false,
  underline: false
};

document.getElementById("color")?.addEventListener("change", (e) => {
  color = e.target.value;
});

backgroundColorInput?.addEventListener("change", () => {
  setBoardBackground();
});

toolSelect?.addEventListener("change", (e) => {
  const selectedTool = e.target.value;

  if (selectedTool.startsWith("shape:")) {
    setShapeTool(selectedTool.slice("shape:".length));
  } else {
    setTool(selectedTool);
  }
});

toolSelect?.addEventListener("dblclick", () => {
  enableMoveMode();
});

[selectToolButton, penToolButton, eraserToolButton, fillToolButton, textToolButton, imageToolButton, tableToolButton].forEach((button) => {
  button?.addEventListener("dblclick", () => {
    enableMoveMode();
  });
});

window.addEventListener("resize", resizeCanvas);
boardResizeHandle?.addEventListener("pointerdown", startBoardResize);

updateToolbarState();
updateScreenShareButtons();
applySavedBoardHeight();
resizeCanvas();
socket.emit("joinRoom", {
  room,
  pageRole: role
});

socket.on("voice-call-started", (data = {}) => {
  voiceCallActive = true;
  teacherSocketId = data.teacherId || null;

  if (role === "student") {
    studentCallBar?.classList.remove("call-hidden");
    if (studentMuteToggleButton) {
      studentMuteToggleButton.disabled = false;
    }
    setCallStatus("Teacher call started");
    updateStudentMuteButton();
  }

  if (role === "teacher") {
    updateTeacherCallButtons();
  }
});

socket.on("voice-call-ended", () => {
  stopVoiceCall(false);
});

socket.on("screen-share-started", (data = {}) => {
  screenShareActive = true;
  screenSharerId = data.sharerId || null;
  updateScreenShareButtons();
  setScreenShareStatus(`${data.name || "Someone"} is sharing`);

  if (screenSharerId && screenSharerId !== socket.id && !data.offerIncoming) {
    socket.emit("screen-share-watch");
  }
});

socket.on("screen-share-ended", () => {
  stopScreenShare(false);
});

socket.on("screen-share-busy", (data = {}) => {
  if (localScreenStream) {
    stopScreenShare(false);
  }

  setScreenShareStatus(`${data.name || "Someone"} is already sharing`);
});

socket.on("screen-share-not-allowed", () => {
  if (localScreenStream) {
    stopScreenShare(false);
  }

  setScreenShareStatus("Screen share is not enabled");
  updateScreenShareButtons();
});

socket.on("screen-share-permission", (data = {}) => {
  screenSharePermissionEnabled = Boolean(data.enabled);
  selectedScreenShareStudentId = data.studentId || "";

  if (role === "teacher" && screenShareToggle) {
    screenShareToggle.checked = screenSharePermissionEnabled;
    renderStudentRadioList();
  }

  if (role === "student") {
    screenShareAllowed = screenSharePermissionEnabled && selectedScreenShareStudentId === socket.id;
    if (!screenShareAllowed && localScreenStream) {
      stopScreenShare(true);
    }
  }

  updateScreenShareButtons();
});

socket.on("screen-share-viewer-joined", async ({ viewerId }) => {
  if (!screenShareActive || !localScreenStream || !viewerId) return;

  const peer = createScreenSharerPeer(viewerId);
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  sendScreenSignal(viewerId, peer.localDescription);
});

socket.on("screen-signal", async ({ fromId, signal }) => {
  if (!fromId || !signal) return;

  if (localScreenStream) {
    const peer = screenSharePeers.get(fromId);
    if (!peer) return;

    if (signal.type === "answer") {
      await peer.setRemoteDescription(signal);
      await flushPendingScreenCandidates(fromId, peer);
    } else if (signal.candidate) {
      await addScreenIceCandidate(fromId, peer, signal);
    }
    return;
  }

  if (signal.type === "offer") {
    await answerScreenShareOffer(fromId, signal);
  } else if (signal.candidate) {
    if (screenViewerPeer) {
      await addScreenIceCandidate("screen-sharer", screenViewerPeer, signal);
    } else {
      const pending = pendingScreenCandidates.get("screen-sharer") || [];
      pending.push(signal);
      pendingScreenCandidates.set("screen-sharer", pending);
    }
  }
});

socket.on("student-list", (students = []) => {
  if (role !== "teacher") return;

  connectedStudents = Array.isArray(students) ? students : [];

  if (selectedScreenShareStudentId && !connectedStudents.some((student) => student.id === selectedScreenShareStudentId)) {
    selectedScreenShareStudentId = "";
    sendScreenSharePermission();
  }

  renderStudentRadioList();
});

socket.on("voice-call-student-joined", async ({ studentId, name }) => {
  if (role !== "teacher" || !voiceCallActive || !localVoiceStream || !studentId) return;

  const peer = createTeacherVoicePeer(studentId, name);
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  sendVoiceSignal(studentId, peer.localDescription);
});

socket.on("voice-signal", async ({ fromId, signal }) => {
  if (!fromId || !signal) return;

  if (role === "teacher") {
    const peer = teacherVoicePeers.get(fromId);
    if (!peer) return;

    if (signal.type === "answer") {
      await peer.setRemoteDescription(signal);
      await flushPendingVoiceCandidates(fromId, peer);
    } else if (signal.candidate) {
      await addVoiceIceCandidate(fromId, peer, signal);
    }
    return;
  }

  if (role === "student") {
    if (signal.type === "offer") {
      await answerTeacherVoiceOffer(fromId, signal);
    } else if (signal.candidate) {
      if (studentVoicePeer) {
        await addVoiceIceCandidate("teacher", studentVoicePeer, signal);
      } else {
        const pending = pendingVoiceCandidates.get("teacher") || [];
        pending.push(signal);
        pendingVoiceCandidates.set("teacher", pending);
      }
    }
  }
});

window.startVoiceCall = async function () {
  if (role !== "teacher" || voiceCallActive) return;

  try {
    localVoiceStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    voiceCallActive = true;
    socket.emit("voice-call-start");
    setCallStatus("Voice connected");
    updateTeacherCallButtons();
  } catch (error) {
    console.error("Unable to start voice call:", error);
    setCallStatus("Mic permission needed");
  }
};

window.endVoiceCall = function () {
  if (role !== "teacher") return;

  socket.emit("voice-call-end");
  stopVoiceCall(false);
};

window.toggleStudentMute = async function () {
  if (role !== "student" || !voiceCallActive) return;

  try {
    if (!studentVoiceJoined) {
      localVoiceStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      studentVoiceJoined = true;
      studentMuted = false;
      setLocalVoiceMuted(false);
      socket.emit("voice-call-join");
      setCallStatus("Voice connected");
      updateStudentMuteButton();
      return;
    }

    studentMuted = !studentMuted;
    setLocalVoiceMuted(studentMuted);
    setCallStatus(studentMuted ? "Muted" : "Unmuted");
    updateStudentMuteButton();
  } catch (error) {
    console.error("Unable to access microphone:", error);
    setCallStatus("Mic permission needed");
  }
};

function createTeacherVoicePeer(studentId, name = "Student") {
  closeTeacherVoicePeer(studentId);

  const peer = new RTCPeerConnection(voicePeerConfig);
  teacherVoicePeers.set(studentId, peer);

  localVoiceStream.getTracks().forEach((track) => {
    peer.addTrack(track, localVoiceStream);
  });

  peer.getTransceivers().forEach((transceiver) => {
    if (transceiver.receiver?.track?.kind === "audio" || transceiver.sender?.track?.kind === "audio") {
      transceiver.direction = "sendrecv";
    }
  });

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      sendVoiceSignal(studentId, event.candidate);
    }
  };

  peer.ontrack = (event) => {
    const stream = event.streams[0] || new MediaStream([event.track]);
    attachRemoteVoice(studentId, stream, name);
    event.track.onunmute = () => {
      attachRemoteVoice(studentId, stream, name);
    };
  };

  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "connected") {
      setCallStatus(`Voice connected (${teacherVoicePeers.size})`);
    }

    if (["failed", "closed"].includes(peer.connectionState)) {
      closeTeacherVoicePeer(studentId);
    }
  };

  setCallStatus(`Voice connected (${teacherVoicePeers.size})`);
  return peer;
}

async function answerTeacherVoiceOffer(fromId, offer) {
  teacherSocketId = fromId;
  if (!studentVoicePeer) {
    studentVoicePeer = createStudentVoicePeer(fromId, localVoiceStream);
  }

  await studentVoicePeer.setRemoteDescription(offer);
  await flushPendingVoiceCandidates("teacher", studentVoicePeer);
  const answer = await studentVoicePeer.createAnswer();
  await studentVoicePeer.setLocalDescription(answer);
  sendVoiceSignal(fromId, studentVoicePeer.localDescription);
}

function createStudentVoicePeer(targetId) {
  const peer = new RTCPeerConnection(voicePeerConfig);

  if (localVoiceStream) {
    localVoiceStream.getAudioTracks().forEach((track) => {
      peer.addTrack(track, localVoiceStream);
    });
  }

  peer.getTransceivers().forEach((transceiver) => {
    if (transceiver.receiver?.track?.kind === "audio" || transceiver.sender?.track?.kind === "audio") {
      transceiver.direction = transceiver.sender?.track ? "sendrecv" : "recvonly";
    }
  });

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      sendVoiceSignal(targetId, event.candidate);
    }
  };

  peer.ontrack = (event) => {
    const stream = event.streams[0] || new MediaStream([event.track]);
    attachRemoteVoice("teacher", stream, "Teacher");
    event.track.onunmute = () => {
      attachRemoteVoice("teacher", stream, "Teacher");
    };
  };

  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "connected") {
      setCallStatus(studentMuted ? "Muted" : "Unmuted");
    }

    if (["failed", "closed"].includes(peer.connectionState)) {
      setCallStatus("Voice reconnecting");
    }
  };

  return peer;
}

function sendVoiceSignal(targetId, signal) {
  socket.emit("voice-signal", {
    targetId,
    signal
  });
}

function attachRemoteVoice(id, stream, label) {
  if (!stream) return;

  let audio = remoteVoiceAudios.get(id);
  if (!audio) {
    audio = document.createElement("audio");
    audio.autoplay = true;
    audio.playsInline = true;
    audio.dataset.voiceLabel = label;
    audio.style.display = "none";
    document.body.appendChild(audio);
    remoteVoiceAudios.set(id, audio);
  }

  audio.srcObject = stream;
  audio.muted = false;
  audio.volume = 1;

  const playPromise = audio.play?.();
  if (playPromise) {
    playPromise.catch(() => {
      setCallStatus(role === "teacher" ? "Browser blocked speaker" : "Tap unmute to hear call");
    });
  }
}

async function addVoiceIceCandidate(id, peer, candidate) {
  if (peer.remoteDescription?.type) {
    await peer.addIceCandidate(candidate);
    return;
  }

  const pending = pendingVoiceCandidates.get(id) || [];
  pending.push(candidate);
  pendingVoiceCandidates.set(id, pending);
}

async function flushPendingVoiceCandidates(id, peer) {
  const pending = pendingVoiceCandidates.get(id) || [];
  if (pending.length === 0) return;

  pendingVoiceCandidates.delete(id);

  for (const candidate of pending) {
    await peer.addIceCandidate(candidate);
  }
}

function setLocalVoiceMuted(muted) {
  localVoiceStream?.getAudioTracks().forEach((track) => {
    track.enabled = !muted;
  });
}

function stopVoiceCall(notifyServer = false) {
  if (notifyServer && role === "teacher") {
    socket.emit("voice-call-end");
  }

  teacherVoicePeers.forEach((peer, studentId) => closeTeacherVoicePeer(studentId));
  teacherVoicePeers.clear();

  if (studentVoicePeer) {
    studentVoicePeer.close();
    studentVoicePeer = null;
  }

  remoteVoiceAudios.forEach((audio) => {
    audio.srcObject = null;
    audio.remove();
  });
  remoteVoiceAudios.clear();
  pendingVoiceCandidates.clear();

  localVoiceStream?.getTracks().forEach((track) => track.stop());
  localVoiceStream = null;
  teacherSocketId = null;
  voiceCallActive = false;
  studentVoiceJoined = false;
  studentMuted = true;

  if (role === "student") {
    studentCallBar?.classList.add("call-hidden");
    if (studentMuteToggleButton) {
      studentMuteToggleButton.disabled = true;
    }
    updateStudentMuteButton();
  }

  updateTeacherCallButtons();
  setCallStatus("Voice off");
}

function closeTeacherVoicePeer(studentId) {
  const peer = teacherVoicePeers.get(studentId);
  if (peer) {
    peer.close();
    teacherVoicePeers.delete(studentId);
  }

  const audio = remoteVoiceAudios.get(studentId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    remoteVoiceAudios.delete(studentId);
  }

  if (role === "teacher" && voiceCallActive) {
    setCallStatus(`Voice connected (${teacherVoicePeers.size})`);
  }
}

function updateTeacherCallButtons() {
  if (startCallButton) {
    startCallButton.disabled = voiceCallActive;
  }

  if (endCallButton) {
    endCallButton.disabled = !voiceCallActive;
  }
}

function updateStudentMuteButton() {
  if (!studentMuteToggleButton) return;

  const icon = studentMuted ? "&#128263;" : "&#128266;";
  const label = studentMuted ? "Unmute" : "Mute";
  studentMuteToggleButton.innerHTML = `<span class="tool-icon" aria-hidden="true">${icon}</span><span>${label}</span>`;
  studentMuteToggleButton.classList.toggle("active", !studentMuted);
}

function setCallStatus(message) {
  if (callStatus) {
    callStatus.textContent = message;
  }
}

window.toggleScreenSharePermission = function () {
  if (role !== "teacher") return;

  screenSharePermissionEnabled = Boolean(screenShareToggle?.checked);
  if (!screenSharePermissionEnabled) {
    selectedScreenShareStudentId = "";
    if (studentPicker) {
      studentPicker.open = false;
    }
    if (localScreenStream) {
      stopScreenShare(true);
    }
  }

  renderStudentRadioList();
  sendScreenSharePermission();
  updateScreenShareButtons();
};

function canStartScreenShare() {
  if (role === "teacher") {
    return screenSharePermissionEnabled && connectedStudents.length > 0;
  }

  return screenShareAllowed;
}

function canShowScreenShareControls() {
  if (role === "teacher") {
    return screenSharePermissionEnabled;
  }

  return screenShareAllowed;
}

function sendScreenSharePermission() {
  if (role !== "teacher") return;

  socket.emit("screen-share-permission", {
    enabled: screenSharePermissionEnabled,
    studentId: selectedScreenShareStudentId
  });
}

function renderStudentRadioList() {
  if (role !== "teacher") return;

  if (studentPickerSummary) {
    const selectedStudent = connectedStudents.find((student) => student.id === selectedScreenShareStudentId);
    studentPickerSummary.textContent = selectedStudent
      ? `Students: ${connectedStudents.length} - ${selectedStudent.name || "Student"}`
      : `Students: ${connectedStudents.length}`;
  }

  if (!studentRadioList) return;

  studentRadioList.innerHTML = "";

  if (connectedStudents.length === 0) {
    const emptyLabel = document.createElement("label");
    emptyLabel.className = "student-radio-option muted-option";
    emptyLabel.innerHTML = '<input type="radio" name="screenShareStudent" value="" disabled><span>No students</span>';
    studentRadioList.appendChild(emptyLabel);
    return;
  }

  connectedStudents.forEach((student) => {
    const label = document.createElement("label");
    label.className = "student-radio-option";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "screenShareStudent";
    radio.value = student.id || "";
    radio.checked = student.id === selectedScreenShareStudentId;
    radio.disabled = !screenSharePermissionEnabled;
    radio.addEventListener("change", () => {
      selectedScreenShareStudentId = radio.value;
      sendScreenSharePermission();
      renderStudentRadioList();
    });

    const name = document.createElement("span");
    name.textContent = student.name || "Student";

    label.appendChild(radio);
    label.appendChild(name);
    studentRadioList.appendChild(label);
  });
}

window.startScreenShare = async function () {
  if (!canStartScreenShare()) {
    setScreenShareStatus(role === "teacher" && screenSharePermissionEnabled
      ? "Connect a student first"
      : "Enable screen share first");
    updateScreenShareButtons();
    return;
  }

  if (screenShareActive && !localScreenStream) {
    setScreenShareStatus("A screen is already shared");
    return;
  }

  if (localScreenStream) return;

  try {
    localScreenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });
    screenShareActive = true;
    screenSharerId = socket.id;
    hideScreenStream();
    setScreenShareStatus("You are sharing");
    updateScreenShareButtons();
    localScreenStream.getVideoTracks()[0]?.addEventListener("ended", () => stopScreenShare(true));
    socket.emit("screen-share-start");
  } catch (error) {
    console.error("Unable to share screen:", error);
    localScreenStream = null;
    setScreenShareStatus("Screen permission needed");
    updateScreenShareButtons();
  }
};

window.stopScreenShare = function (notifyServer = true) {
  if (notifyServer && localScreenStream) {
    socket.emit("screen-share-end");
  }

  screenSharePeers.forEach((peer) => peer.close());
  screenSharePeers.clear();

  if (screenViewerPeer) {
    screenViewerPeer.close();
    screenViewerPeer = null;
  }

  pendingScreenCandidates.clear();
  localScreenStream?.getTracks().forEach((track) => track.stop());
  localScreenStream = null;
  screenShareActive = false;
  screenSharerId = null;

  if (screenShareVideo) {
    hideScreenStream();
  }

  resizeCanvas();
  setScreenShareStatus("No screen shared");
  updateScreenShareButtons();
};

window.leaveStudentBoard = function () {
  window.location.href = "/logout";
};

function createScreenSharerPeer(viewerId) {
  closeScreenSharePeer(viewerId);

  const peer = new RTCPeerConnection(voicePeerConfig);
  screenSharePeers.set(viewerId, peer);

  localScreenStream.getTracks().forEach((track) => {
    peer.addTrack(track, localScreenStream);
  });

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      sendScreenSignal(viewerId, event.candidate);
    }
  };

  peer.onconnectionstatechange = () => {
    if (["failed", "closed"].includes(peer.connectionState)) {
      closeScreenSharePeer(viewerId);
    }
  };

  return peer;
}

async function answerScreenShareOffer(fromId, offer) {
  screenSharerId = fromId;
  if (!screenViewerPeer) {
    screenViewerPeer = createScreenViewerPeer(fromId);
  }

  await screenViewerPeer.setRemoteDescription(offer);
  await flushPendingScreenCandidates("screen-sharer", screenViewerPeer);
  const answer = await screenViewerPeer.createAnswer();
  await screenViewerPeer.setLocalDescription(answer);
  sendScreenSignal(fromId, screenViewerPeer.localDescription);
}

function createScreenViewerPeer(targetId) {
  const peer = new RTCPeerConnection(voicePeerConfig);

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      sendScreenSignal(targetId, event.candidate);
    }
  };

  peer.ontrack = (event) => {
    const stream = event.streams[0] || new MediaStream([event.track]);
    showScreenStream(stream, false);
    setScreenShareStatus("Viewing shared screen");
  };

  peer.onconnectionstatechange = () => {
    if (["failed", "closed"].includes(peer.connectionState)) {
      setScreenShareStatus("Screen share reconnecting");
    }
  };

  return peer;
}

function showScreenStream(stream, muted) {
  if (!screenShareVideo) return;

  screenShareVideo.srcObject = stream;
  screenShareVideo.muted = muted;
  screenShareVideo.classList.add("active");
  resizeCanvas();
  screenShareVideo.play?.().catch(() => {
    setScreenShareStatus("Tap video to play");
  });
}

function hideScreenStream() {
  if (!screenShareVideo) return;

  screenShareVideo.srcObject = null;
  screenShareVideo.classList.remove("active");
  resizeCanvas();
}

function sendScreenSignal(targetId, signal) {
  socket.emit("screen-signal", {
    targetId,
    signal
  });
}

async function addScreenIceCandidate(id, peer, candidate) {
  if (peer.remoteDescription?.type) {
    await peer.addIceCandidate(candidate);
    return;
  }

  const pending = pendingScreenCandidates.get(id) || [];
  pending.push(candidate);
  pendingScreenCandidates.set(id, pending);
}

async function flushPendingScreenCandidates(id, peer) {
  const pending = pendingScreenCandidates.get(id) || [];
  if (pending.length === 0) return;

  pendingScreenCandidates.delete(id);

  for (const candidate of pending) {
    await peer.addIceCandidate(candidate);
  }
}

function closeScreenSharePeer(viewerId) {
  const peer = screenSharePeers.get(viewerId);
  if (peer) {
    peer.close();
    screenSharePeers.delete(viewerId);
  }
}

function updateScreenShareButtons() {
  const canShare = canStartScreenShare();
  const shouldShowPanel = canShowScreenShareControls() || Boolean(localScreenStream);
  const screenSharePanel = document.getElementById("screenSharePanel");

  if (screenSharePanel) {
    screenSharePanel.classList.toggle("screen-share-hidden", !shouldShowPanel);
  }

  if (role === "teacher" && screenSharePermissionEnabled && connectedStudents.length === 0 && !localScreenStream) {
    setScreenShareStatus("Connect a student first");
  }

  if (shareScreenButton) {
    shareScreenButton.disabled = !canShare || Boolean(localScreenStream) || (screenShareActive && screenSharerId !== socket.id);
  }

  if (stopScreenShareButton) {
    stopScreenShareButton.disabled = !localScreenStream;
  }
}

function setScreenShareStatus(message) {
  if (screenShareStatus) {
    screenShareStatus.textContent = message;
  }
}

function makeDrawData(x, y, type = "move") {
  return {
    type,
    x: x / canvas.width,
    y: y / canvas.height,
    color: tool === "eraser" ? backgroundColor : color,
    eraser: tool === "eraser",
    lineWidth: tool === "eraser" ? 18 : 3,
    strokeId: currentStrokeId
  };
}

function startBoardResize(event) {
  if (!boardResizeHandle) return;

  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  boardResizeInteraction = {
    startY: event.clientY,
    startHeight: rect.height
  };
  boardResizeHandle.classList.add("resizing");
  document.body.classList.add("board-resizing");
  boardResizeHandle.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", updateBoardResize);
  window.addEventListener("pointerup", stopBoardResize);
  window.addEventListener("pointercancel", stopBoardResize);
}

function updateBoardResize(event) {
  if (!boardResizeInteraction) return;

  const deltaY = event.clientY - boardResizeInteraction.startY;
  const bounds = getBoardHeightBounds();
  const nextHeight = clamp(boardResizeInteraction.startHeight + deltaY, bounds.min, bounds.max);
  setBoardDisplayHeight(nextHeight);
  resizeCanvas();
}

function stopBoardResize() {
  if (!boardResizeInteraction) return;

  const height = canvas.getBoundingClientRect().height;
  localStorage.setItem(getBoardHeightStorageKey(), String(Math.round(height)));
  boardResizeInteraction = null;
  boardResizeHandle?.classList.remove("resizing");
  document.body.classList.remove("board-resizing");
  window.removeEventListener("pointermove", updateBoardResize);
  window.removeEventListener("pointerup", stopBoardResize);
  window.removeEventListener("pointercancel", stopBoardResize);
}

function setBoardDisplayHeight(height) {
  const chatContainer = document.getElementById("chatContainer");
  const bounds = getBoardHeightBounds();
  const nextHeight = clamp(height, bounds.min, bounds.max);
  const nextChatHeight = Math.max(bounds.minChat, bounds.available - nextHeight);

  canvas.style.flex = `0 0 ${nextHeight}px`;
  canvas.style.height = `${nextHeight}px`;

  if (chatContainer) {
    chatContainer.style.flex = `0 0 ${nextChatHeight}px`;
    chatContainer.style.height = `${nextChatHeight}px`;
  }
}

function getBoardHeightBounds() {
  const mainHeight = document.getElementById("main")?.getBoundingClientRect().height || window.innerHeight;
  const toolbarHeight = document.getElementById("toolbar")?.getBoundingClientRect().height || 0;
  const studentTopBarHeight = studentTopBar?.getBoundingClientRect().height || 0;
  const callBarHeight = studentCallBar && !studentCallBar.classList.contains("call-hidden")
    ? studentCallBar.getBoundingClientRect().height
    : 0;
  const screenPanel = document.getElementById("screenSharePanel");
  const screenPanelHeight = screenPanel && !screenPanel.closest("#toolbar")
    ? screenPanel.getBoundingClientRect().height
    : 0;
  const screenVideoHeight = screenShareVideo?.classList.contains("active")
    ? screenShareVideo.getBoundingClientRect().height
    : 0;
  const handleHeight = boardResizeHandle?.getBoundingClientRect().height || 0;
  const minChat = window.matchMedia("(max-width: 700px)").matches ? 72 : 90;
  const availableHeight = Math.max(260, mainHeight - toolbarHeight - studentTopBarHeight - callBarHeight - screenPanelHeight - screenVideoHeight - handleHeight);

  return {
    min: 180,
    max: Math.max(180, availableHeight - minChat),
    minChat,
    available: availableHeight
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

  if (tool === "select") {
    commitOpenTextEditor();
    startSelectInteraction(e.offsetX, e.offsetY);
    return;
  }

  if (tool === "fill") {
    commitOpenTextEditor();
    fillAtPoint(e.offsetX, e.offsetY);
    return;
  }

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
        handle: isOnImageResizeHandle(image, e.offsetX, e.offsetY) ? "se" : null,
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
    if (moveMode) {
      const shape = findBoardObjectAt(e.offsetX, e.offsetY, (event) => event.kind === "shape");

      if (shape) {
        startBoardObjectMove(shape, e.offsetX, e.offsetY);
        return;
      }
    }

    startShape(e.offsetX, e.offsetY);
    return;
  }

  commitOpenTextEditor();
  setBoardPoint(e.offsetX, e.offsetY);
  drawing = true;
  currentStrokeId = createBoardObjectId("stroke");
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

  if (tool === "select") {
    commitOpenTextEditor();
    startSelectInteraction(point.x, point.y);
    return;
  }

  if (tool === "fill") {
    commitOpenTextEditor();
    fillAtPoint(point.x, point.y);
    return;
  }

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
        handle: isOnImageResizeHandle(image, point.x, point.y) ? "se" : null,
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
    if (moveMode) {
      const shape = findBoardObjectAt(point.x, point.y, (event) => event.kind === "shape");

      if (shape) {
        startBoardObjectMove(shape, point.x, point.y);
        return;
      }
    }

    startShape(point.x, point.y);
    return;
  }

  commitOpenTextEditor();
  setBoardPoint(point.x, point.y);
  drawing = true;
  currentStrokeId = createBoardObjectId("stroke");

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

  if (imageInteraction) {
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

  if (!["pen", "eraser"].includes(tool)) return;
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

  if (imageInteraction) {
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

  if (!["pen", "eraser"].includes(tool)) return;
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
  sendDrawData({ type: "end", strokeId: currentStrokeId });
  currentStrokeId = null;
}

function drawLine(data) {
  if (data.kind === "background") {
    applyBackgroundEvent(data);
    return;
  }

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

  ctx.strokeStyle = data.eraser ? backgroundColor : data.color;
  ctx.lineWidth = data.lineWidth || 3;
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
  applyObjectRotation(data);
  if (data.fillColor) {
    ctx.fillStyle = data.fillColor;
    ctx.fillRect(x, y, width, height);
  }
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
  applyObjectRotation(data);
  ctx.fillStyle = data.fillColor || "transparent";
  ctx.strokeStyle = data.color || "#000000";
  ctx.lineWidth = data.lineWidth || 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (data.shape === "line") {
    const startX = x + (data.startOffsetX || 0) * width;
    const startY = y + (data.startOffsetY || 0) * height;
    const endX = x + (data.endOffsetX ?? 1) * width;
    const endY = y + (data.endOffsetY ?? 1) * height;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  } else if (data.shape === "circle") {
    ctx.beginPath();
    ctx.ellipse(x + width / 2, y + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2);
    fillCurrentPath(data);
    ctx.stroke();
  } else if (data.shape === "triangle") {
    ctx.beginPath();
    ctx.moveTo(x + width / 2, y);
    ctx.lineTo(x + width, y + height);
    ctx.lineTo(x, y + height);
    ctx.closePath();
    fillCurrentPath(data);
    ctx.stroke();
  } else if (data.shape === "diamond") {
    strokePolygon([
      [x + width / 2, y],
      [x + width, y + height / 2],
      [x + width / 2, y + height],
      [x, y + height / 2]
    ], Boolean(data.fillColor));
  } else if (data.shape === "pentagon") {
    strokeRegularPolygon(x, y, width, height, 5, -Math.PI / 2, Boolean(data.fillColor));
  } else if (data.shape === "hexagon") {
    strokeRegularPolygon(x, y, width, height, 6, Math.PI / 6, Boolean(data.fillColor));
  } else if (data.shape === "star") {
    strokeStar(x, y, width, height, Boolean(data.fillColor));
  } else if (data.shape === "arrow") {
    strokeArrow(x, y, width, height, data);
  } else if (data.shape === "parallelogram") {
    const slant = width * 0.22;

    strokePolygon([
      [x + slant, y],
      [x + width, y],
      [x + width - slant, y + height],
      [x, y + height]
    ], Boolean(data.fillColor));
  } else {
    if (data.fillColor) {
      ctx.fillRect(x, y, width, height);
    }
    ctx.strokeRect(x, y, width, height);
  }

  ctx.restore();
  ctx.beginPath();
}

function strokePolygon(points, shouldFill = false) {
  ctx.beginPath();
  points.forEach(([pointX, pointY], index) => {
    if (index === 0) {
      ctx.moveTo(pointX, pointY);
    } else {
      ctx.lineTo(pointX, pointY);
    }
  });
  ctx.closePath();
  if (shouldFill) {
    ctx.fill();
  }
  ctx.stroke();
}

function fillCurrentPath(data) {
  if (data.fillColor) {
    ctx.fill();
  }
}

function strokeRegularPolygon(x, y, width, height, sides, rotation = 0, shouldFill = false) {
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const radiusX = Math.abs(width / 2);
  const radiusY = Math.abs(height / 2);
  const points = [];

  for (let index = 0; index < sides; index += 1) {
    const angle = rotation + (index * Math.PI * 2) / sides;
    points.push([
      centerX + Math.cos(angle) * radiusX,
      centerY + Math.sin(angle) * radiusY
    ]);
  }

  strokePolygon(points, shouldFill);
}

function strokeStar(x, y, width, height, shouldFill = false) {
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const outerRadiusX = Math.abs(width / 2);
  const outerRadiusY = Math.abs(height / 2);
  const innerRadiusX = outerRadiusX * 0.45;
  const innerRadiusY = outerRadiusY * 0.45;
  const points = [];

  for (let index = 0; index < 10; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    const radiusX = index % 2 === 0 ? outerRadiusX : innerRadiusX;
    const radiusY = index % 2 === 0 ? outerRadiusY : innerRadiusY;

    points.push([
      centerX + Math.cos(angle) * radiusX,
      centerY + Math.sin(angle) * radiusY
    ]);
  }

  strokePolygon(points, shouldFill);
}

function strokeArrow(x, y, width, height, data) {
  const startX = x + (data.startOffsetX || 0) * width;
  const startY = y + (data.startOffsetY ?? 0.5) * height;
  const endX = x + (data.endOffsetX ?? 1) * width;
  const endY = y + (data.endOffsetY ?? 0.5) * height;
  const angle = Math.atan2(endY - startY, endX - startX);
  const length = Math.hypot(endX - startX, endY - startY);
  const headLength = Math.min(length * 0.28, 28);
  const headAngle = Math.PI / 7;

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.moveTo(endX, endY);
  ctx.lineTo(
    endX - Math.cos(angle - headAngle) * headLength,
    endY - Math.sin(angle - headAngle) * headLength
  );
  ctx.moveTo(endX, endY);
  ctx.lineTo(
    endX - Math.cos(angle + headAngle) * headLength,
    endY - Math.sin(angle + headAngle) * headLength
  );
  ctx.stroke();
}

function recordBoardEvent(data) {
  if (data.kind === "background") {
    applyBackgroundEvent(data);
  }

  if (isReplaceableBoardObject(data)) {
    const existingIndex = boardEvents.findIndex((event) => event.id === data.id);

    if (existingIndex >= 0) {
      if (data.bringToFront) {
        boardEvents.splice(existingIndex, 1);
        boardEvents.push(data);
        return;
      }

      boardEvents[existingIndex] = data;
      return;
    }
  }

  boardEvents.push(data);
}

function isReplaceableBoardObject(data) {
  return ["background", "image", "table", "shape"].includes(data.kind) && data.id;
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
  syncBackgroundFromEvents();
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

  ctx.save();
  applyObjectRotation(data);
  ctx.drawImage(image, x, y, width, height);
  ctx.restore();
  ctx.beginPath();

  if (role === "teacher" && selectedImageId === data.id) {
    drawImageSelection(data);
  }
}

function drawImageSelection(data) {
  drawTransformSelection(data);
}

function applyObjectRotation(object) {
  const rotation = getObjectRotation(object);
  if (!rotation) return;

  const center = getObjectCenterPixels(object);
  ctx.translate(center.x, center.y);
  ctx.rotate(rotation);
  ctx.translate(-center.x, -center.y);
}

function getObjectRotation(object) {
  return Number(object.rotation) || 0;
}

function getObjectBoxPixels(object) {
  return {
    x: object.x * canvas.width,
    y: object.y * canvas.height,
    width: object.width * canvas.width,
    height: object.height * canvas.height
  };
}

function getObjectCenterPixels(object) {
  const box = getObjectBoxPixels(object);

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

function rotatePointAroundCenter(x, y, object, angle) {
  const center = getObjectCenterPixels(object);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const deltaX = x - center.x;
  const deltaY = y - center.y;

  return {
    x: center.x + deltaX * cos - deltaY * sin,
    y: center.y + deltaX * sin + deltaY * cos
  };
}

function getResizeHandles(object) {
  const box = getObjectBoxPixels(object);

  return [
    { name: "nw", x: box.x, y: box.y },
    { name: "ne", x: box.x + box.width, y: box.y },
    { name: "se", x: box.x + box.width, y: box.y + box.height },
    { name: "sw", x: box.x, y: box.y + box.height }
  ];
}

function getRotateHandlePoint(object) {
  const box = getObjectBoxPixels(object);

  return {
    x: box.x + box.width / 2,
    y: box.y - getRotateHandleDistance()
  };
}

function getTransformHandleSize() {
  return 12;
}

function getRotateHandleDistance() {
  return 28;
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
  fillCanvasBackground();
  const events = [...boardEvents];
  events
    .filter((event) => event.kind !== "background")
    .forEach(drawLine);
  drawSelectedBoardObjectOutline();
  drawSelectedImageOutline();
}

function fillCanvasBackground() {
  ctx.save();
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function applyBackgroundEvent(data) {
  backgroundColor = data.color || "#ffffff";

  if (backgroundColorInput) {
    backgroundColorInput.value = backgroundColor;
  }
}

function syncBackgroundFromEvents() {
  const backgroundEvent = [...boardEvents].reverse().find((event) => event.kind === "background");
  applyBackgroundEvent(backgroundEvent || { color: "#ffffff" });
}

socket.on("draw", (data) => {
  recordBoardEvent(data);
  if (isReplaceableBoardObject(data)) {
    redrawBoard();
  } else {
    drawLine(data);
  }
  updateHistoryButtons();
});

socket.on("boardState", (events) => {
  boardEvents = cloneBoardEvents(events || []);
  syncBackgroundFromEvents();
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
  applyBackgroundEvent({ color: "#ffffff" });
  selectedImageId = null;
  selectedBoardObjectId = null;
  imageInteraction = null;
  boardObjectInteraction = null;
  redrawBoard();
  socket.emit("clear");
  updateHistoryButtons();
}

socket.on("clear", () => {
  boardEvents = [];
  applyBackgroundEvent({ color: "#ffffff" });
  selectedImageId = null;
  selectedBoardObjectId = null;
  imageInteraction = null;
  boardObjectInteraction = null;
  redrawBoard();
  undoStack = [];
  redoStack = [];
  updateHistoryButtons();
});

window.setBoardBackground = function () {
  if (role !== "teacher") return;

  const nextColor = backgroundColorInput?.value || "#ffffff";
  if (nextColor === backgroundColor) return;

  pushUndoSnapshot();
  sendDrawData({
    kind: "background",
    id: "background",
    color: nextColor
  });
};

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
  if (nextTool !== "select") {
    clearSelectionState();
  }
  moveMode = false;
  tool = nextTool;
  updateToolbarState();
};

window.setShapeTool = function (nextShapeType) {
  if (role !== "teacher") return;

  commitOpenTextEditor();
  stopShapeInteraction(false);
  clearSelectionState();
  moveMode = false;
  shapeType = nextShapeType;
  tool = "shape";
  updateToolbarState();
};

function enableMoveMode() {
  if (role !== "teacher") return;

  commitOpenTextEditor();
  stopShapeInteraction(false);
  moveMode = true;
  updateToolbarState();
}

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
  selectedBoardObjectId = null;
  selectedImageId = null;
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

  if (!commit || isTinyShape(data)) {
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

  const data = {
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

  if (shapeType === "line") {
    data.startOffsetX = interaction.startX <= interaction.currentX ? 0 : 1;
    data.startOffsetY = interaction.startY <= interaction.currentY ? 0 : 1;
    data.endOffsetX = interaction.startX <= interaction.currentX ? 1 : 0;
    data.endOffsetY = interaction.startY <= interaction.currentY ? 1 : 0;
  } else if (shapeType === "arrow") {
    data.startOffsetX = interaction.startX <= interaction.currentX ? 0 : 1;
    data.startOffsetY = interaction.startY <= interaction.currentY ? 0 : 1;
    data.endOffsetX = interaction.startX <= interaction.currentX ? 1 : 0;
    data.endOffsetY = interaction.startY <= interaction.currentY ? 1 : 0;
  }

  return data;
}

function isTinyShape(data) {
  if (data.shape === "line" || data.shape === "arrow") {
    return Math.hypot(data.width, data.height) < 0.005;
  }

  return data.width < 0.005 || data.height < 0.005;
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
    if (isPointInBoardObject(event, pointX, pointY)) return event;
  }

  return null;
}

function startSelectInteraction(x, y) {
  startSelectionMove(x, y);
}

function startSelectionMove(x, y) {
  const currentSelection = getSelectedTransformObject();
  const handle = currentSelection ? getTransformHandleAt(currentSelection, x, y) : null;
  const selectedObject = handle ? currentSelection : findSelectableObjectAt(x, y);

  if (!selectedObject) {
    selectedImageId = null;
    selectedBoardObjectId = null;
    redrawBoard();
    return;
  }

  const mode = handle?.mode || "move";

  if (selectedObject.kind === "image") {
    selectedBoardObjectId = null;
    selectedImageId = selectedObject.id;
    imageInteraction = {
      mode,
      handle: handle?.name,
      startX: x / canvas.width,
      startY: y / canvas.height,
      original: { ...selectedObject },
      historyRecorded: false
    };
    redrawBoard();
    return;
  }

  startBoardObjectMove(selectedObject, x, y, mode, handle?.name);
}

function clearObjectSelection() {
  selectedImageId = null;
  selectedBoardObjectId = null;
}

function clearSelectionState() {
  clearObjectSelection();
}

function findSelectableObjectAt(x, y) {
  const pointX = x / canvas.width;
  const pointY = y / canvas.height;

  for (let index = boardEvents.length - 1; index >= 0; index -= 1) {
    const event = boardEvents[index];

    if (!["image", "table", "shape"].includes(event.kind)) continue;
    if (isPointInBoardObject(event, pointX, pointY)) return event;
  }

  return null;
}

function fillAtPoint(x, y) {
  const selectedObject = getSelectedTransformObject();
  const target = selectedObject || findSelectableObjectAt(x, y);

  if (!target) {
    pushUndoSnapshot();
    if (backgroundColorInput) {
      backgroundColorInput.value = color;
    }
    sendDrawData({
      kind: "background",
      id: "background",
      color
    });
    return;
  }

  if (target.kind === "image") {
    return;
  }

  pushUndoSnapshot();
  const nextObject = { ...target };

  if (target.kind === "shape" && ["line", "arrow"].includes(target.shape)) {
    nextObject.color = color;
  } else {
    nextObject.fillColor = color;
  }

  nextObject.bringToFront = true;
  selectedImageId = null;
  selectedBoardObjectId = nextObject.id;
  sendDrawData(nextObject);
}

function isPointInBoardObject(object, pointX, pointY) {
  if (getObjectRotation(object)) {
    const localPoint = getLocalBoardPoint(object, pointX * canvas.width, pointY * canvas.height);
    pointX = localPoint.x;
    pointY = localPoint.y;
  }

  const toleranceX = 10 / canvas.width;
  const toleranceY = 10 / canvas.height;
  const minX = Math.min(object.x, object.x + object.width) - toleranceX;
  const maxX = Math.max(object.x, object.x + object.width) + toleranceX;
  const minY = Math.min(object.y, object.y + object.height) - toleranceY;
  const maxY = Math.max(object.y, object.y + object.height) + toleranceY;

  if (object.kind === "shape" && ["line", "arrow"].includes(object.shape)) {
    const startX = object.x + (object.startOffsetX || 0) * object.width;
    const startY = object.y + (object.startOffsetY || 0) * object.height;
    const endX = object.x + (object.endOffsetX ?? 1) * object.width;
    const endY = object.y + (object.endOffsetY ?? 1) * object.height;
    const distance = distanceToSegment(pointX, pointY, startX, startY, endX, endY);

    return distance <= Math.max(toleranceX, toleranceY);
  }

  return pointX >= minX && pointX <= maxX && pointY >= minY && pointY <= maxY;
}

function distanceToSegment(pointX, pointY, startX, startY, endX, endY) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared === 0) {
    return Math.hypot(pointX - startX, pointY - startY);
  }

  const t = clamp(((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared, 0, 1);
  const projectedX = startX + t * deltaX;
  const projectedY = startY + t * deltaY;

  return Math.hypot(pointX - projectedX, pointY - projectedY);
}

function getSelectedTransformObject() {
  if (selectedImageId) {
    return boardEvents.find((event) => event.kind === "image" && event.id === selectedImageId) || null;
  }

  if (selectedBoardObjectId) {
    return boardEvents.find((event) => event.id === selectedBoardObjectId) || null;
  }

  return null;
}

function getTransformHandleAt(object, x, y) {
  const point = rotatePointAroundCenter(x, y, object, -getObjectRotation(object));
  const handleSize = getTransformHandleSize();
  const rotatePoint = getRotateHandlePoint(object);
  const resizeHandle = getResizeHandles(object).find((handle) => {
    return Math.abs(point.x - handle.x) <= handleSize && Math.abs(point.y - handle.y) <= handleSize;
  });

  if (resizeHandle) {
    return {
      mode: "resize",
      name: resizeHandle.name
    };
  }

  if (Math.hypot(point.x - rotatePoint.x, point.y - rotatePoint.y) <= handleSize) {
    return {
      mode: "rotate",
      name: "rotate"
    };
  }

  return null;
}

function transformSelectedObject(interaction, x, y) {
  if (interaction.mode === "resize") {
    return resizeObject(interaction.original, x, y, interaction.handle);
  }

  if (interaction.mode === "rotate") {
    return rotateObject(interaction.original, x, y);
  }

  return moveObject(interaction.original, x, y, interaction.startX, interaction.startY);
}

function moveObject(original, x, y, startX, startY) {
  const pointerX = x / canvas.width;
  const pointerY = y / canvas.height;
  const deltaX = pointerX - startX;
  const deltaY = pointerY - startY;

  return {
    ...original,
    x: clamp(original.x + deltaX, 0, Math.max(0, 1 - original.width)),
    y: clamp(original.y + deltaY, 0, Math.max(0, 1 - original.height))
  };
}

function resizeObject(original, x, y, handle) {
  const minWidth = 0.02;
  const minHeight = 0.02;
  const localPoint = getLocalBoardPoint(original, x, y);
  const edges = getResizeEdges(original, handle, localPoint);
  const width = Math.max(minWidth, edges.right - edges.left);
  const height = Math.max(minHeight, edges.bottom - edges.top);
  const nextX = clamp(edges.left, 0, Math.max(0, 1 - minWidth));
  const nextY = clamp(edges.top, 0, Math.max(0, 1 - minHeight));

  return {
    ...original,
    x: nextX,
    y: nextY,
    width: clamp(width, minWidth, 1 - nextX),
    height: clamp(height, minHeight, 1 - nextY)
  };
}

function rotateObject(original, x, y) {
  const center = getObjectCenterPixels(original);
  const angle = Math.atan2(y - center.y, x - center.x) + Math.PI / 2;

  return {
    ...original,
    rotation: angle
  };
}

function getResizeEdges(original, handle, localPoint) {
  handle = handle || "se";
  const edges = {
    left: original.x,
    right: original.x + original.width,
    top: original.y,
    bottom: original.y + original.height
  };

  if (handle.includes("w")) edges.left = localPoint.x;
  if (handle.includes("e")) edges.right = localPoint.x;
  if (handle.includes("n")) edges.top = localPoint.y;
  if (handle.includes("s")) edges.bottom = localPoint.y;

  if (edges.left > edges.right) {
    [edges.left, edges.right] = [edges.right, edges.left];
  }

  if (edges.top > edges.bottom) {
    [edges.top, edges.bottom] = [edges.bottom, edges.top];
  }

  return edges;
}

function getLocalBoardPoint(object, x, y) {
  const point = rotatePointAroundCenter(x, y, object, -getObjectRotation(object));

  return {
    x: point.x / canvas.width,
    y: point.y / canvas.height
  };
}

function startBoardObjectMove(object, x, y, mode = "move", handle = null) {
  if (!object.id) {
    object.id = createBoardObjectId(object.kind);
    recordBoardEvent(object);
  }

  selectedImageId = null;
  selectedBoardObjectId = object.id;
  boardObjectInteraction = {
    mode,
    handle,
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

  const nextObject = transformSelectedObject(boardObjectInteraction, x, y);

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

  drawTransformSelection(selectedObject);
}

function drawTransformSelection(object) {
  const box = getObjectBoxPixels(object);
  const handleSize = getTransformHandleSize();
  const rotateHandle = getRotateHandleDistance();

  ctx.save();
  applyObjectRotation(object);
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.setLineDash([]);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#2563eb";

  getResizeHandles(object).forEach((handle) => {
    ctx.fillRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
  });

  ctx.beginPath();
  ctx.moveTo(box.x + box.width / 2, box.y);
  ctx.lineTo(box.x + box.width / 2, box.y - rotateHandle);
  ctx.stroke();
  const rotatePoint = getRotateHandlePoint(object);
  ctx.beginPath();
  ctx.arc(rotatePoint.x, rotatePoint.y, handleSize / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
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

  const nextImage = transformSelectedObject(imageInteraction, x, y);

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
  document.getElementById("toolbar")?.classList.toggle("move-mode", moveMode);
  selectToolButton?.classList.toggle("active", tool === "select");
  penToolButton?.classList.toggle("active", tool === "pen");
  eraserToolButton?.classList.toggle("active", tool === "eraser");
  fillToolButton?.classList.toggle("active", tool === "fill");
  textToolButton?.classList.toggle("active", tool === "text");
  imageToolButton?.classList.toggle("active", tool === "image");
  tableToolButton?.classList.toggle("active", tool === "table");
  rectangleToolButton?.classList.toggle("active", tool === "shape" && shapeType === "rectangle");
  circleToolButton?.classList.toggle("active", tool === "shape" && shapeType === "circle");
  triangleToolButton?.classList.toggle("active", tool === "shape" && shapeType === "triangle");
  lineToolButton?.classList.toggle("active", tool === "shape" && shapeType === "line");
  diamondToolButton?.classList.toggle("active", tool === "shape" && shapeType === "diamond");
  pentagonToolButton?.classList.toggle("active", tool === "shape" && shapeType === "pentagon");
  hexagonToolButton?.classList.toggle("active", tool === "shape" && shapeType === "hexagon");
  starToolButton?.classList.toggle("active", tool === "shape" && shapeType === "star");
  arrowToolButton?.classList.toggle("active", tool === "shape" && shapeType === "arrow");
  parallelogramToolButton?.classList.toggle("active", tool === "shape" && shapeType === "parallelogram");
  if (toolSelect) {
    toolSelect.value = tool === "shape" ? `shape:${shapeType}` : tool;
  }
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
