const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

app.use(express.static("public"));

let bingoStarted = false;
let drawnNumbers = [];

const PRIZE = 100;

app.post("/start", (req, res) => {
  bingoStarted = true;
  drawnNumbers = [];

  io.emit("bingoStarted");

  res.json({
    success: true
  });
});

app.post("/stop", (req, res) => {
  bingoStarted = false;

  io.emit("bingoStopped");

  res.json({
    success: true
  });
});

app.post("/draw", (req, res) => {

  if (!bingoStarted) {
    return res.json({
      message: "Please start Bingo first."
    });
  }

  if (drawnNumbers.length >= 75) {
    return res.json({
      message: "All 75 numbers have been drawn."
    });
  }

  let number;

  do {
    number = Math.floor(Math.random() * 75) + 1;
  } while (drawnNumbers.includes(number));

  drawnNumbers.push(number);

  io.emit("number", number);

  res.json({
    number: number
  });
});

io.on("connection", (socket) => {

  console.log("Player connected:", socket.id);

  socket.on("bingo", () => {

    if (!bingoStarted) return;

    console.log(
      "BINGO received from:",
      socket.id
    );

    bingoStarted = false;

    io.emit("winner", {
      socketId: socket.id,
      prize: PRIZE,
      message: "BINGO! YOU WIN " + PRIZE + " BIRR!"
    });

  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
  });

});

server.listen(PORT, () => {
  console.log(
    "Bingo running at http://localhost:" + PORT
  );
});