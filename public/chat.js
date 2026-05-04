const chatBox = document.getElementById("chatBox");

const name = prompt("Enter your name");

// IMPORTANT: do NOT redeclare role here

window.sendMsg = function () {
  const input = document.getElementById("msg");
  const msg = input.value;

  if (!msg) return;

  const data = {
    name,
    msg,
    role
  };

  socket.emit("chat", data);
  input.value = "";
};

socket.on("chat", (data) => {
  const div = document.createElement("div");
  div.classList.add("message", data.role);

  const nameDiv = document.createElement("div");
  nameDiv.classList.add("name");
  nameDiv.textContent = data.name;

  const msgDiv = document.createElement("div");
  msgDiv.textContent = data.msg;

  div.appendChild(nameDiv);
  div.appendChild(msgDiv);

  chatBox.appendChild(div);

  chatBox.scrollTop = chatBox.scrollHeight;
});