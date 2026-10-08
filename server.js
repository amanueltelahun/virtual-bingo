require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const PRIZE = 100;

app.use(express.json());
app.use(express.static("public"));

/* =========================
   TELEGRAM BOT
========================= */

const bot = new TelegramBot(
  process.env.BOT_TOKEN,
  { polling: true }
);

bot.onText(/\/start/, (msg) => {

  const chatId = msg.chat.id;

  bot.sendMessage(
    chatId,
    "🎱 Welcome to Virtual Bingo!\n\n" +
    "🎮 Play Bingo:\n" +
    "http://localhost:3000\n\n" +
    "💰 Demo Birr only"
  );

});

bot.onText(/\/help/, (msg) => {

  bot.sendMessage(
    msg.chat.id,
    "🎱 Virtual Bingo Commands\n\n" +
    "/start - Start Bingo Bot\n" +
    "/help - Show commands"
  );

});

console.log("Telegram Bot started");

/* =========================
   BINGO DATA
========================= */

let bingoStarted = false;
let drawnNumbers = [];

let bingoWinners = [];
let winnerTimer = null;

/* =========================
   LOGIN
========================= */

app.post("/login", (req, res) => {

  const { username, password } = req.body;

  if (!username || !password) {

    return res.json({
      success: false,
      message: "Username and password are required."
    });

  }

  if (
    username === "admin" &&
    password === "1234"
  ) {

    return res.json({
      success: true,
      role: "admin",
      username: username
    });

  }

  return res.json({
    success: true,
    role: "player",
    username: username
  });

});

/* =========================
   START BINGO
========================= */

app.post("/start", (req, res) => {

  bingoStarted = true;

  drawnNumbers = [];
  bingoWinners = [];

  if (winnerTimer) {

    clearTimeout(winnerTimer);
    winnerTimer = null;

  }

  io.emit("bingoStarted");

  console.log("BINGO STARTED");

  res.json({
    success: true
  });

});

/* =========================
   STOP BINGO
========================= */

app.post("/stop", (req, res) => {

  bingoStarted = false;

  if (winnerTimer) {

    clearTimeout(winnerTimer);
    winnerTimer = null;

  }

  io.emit("bingoStopped");

  console.log("BINGO STOPPED");

  res.json({
    success: true
  });

});

/* =========================
   DRAW NUMBER
========================= */

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

    number =
      Math.floor(
        Math.random() * 75
      ) + 1;

  } while (
    drawnNumbers.includes(number)
  );

  drawnNumbers.push(number);

  console.log(
    "Number drawn:",
    number
  );

  io.emit(
    "number",
    number
  );

  res.json({
    number: number
  });

});

/* =========================
   SOCKET.IO
========================= */

io.on("connection", (socket) => {

  console.log(
    "Player connected:",
    socket.id
  );

  socket.on("bingo", () => {

    if (!bingoStarted) {
      return;
    }

    if (
      bingoWinners.includes(
        socket.id
      )
    ) {

      return;

    }

    bingoWinners.push(
      socket.id
    );

    console.log(
      "BINGO received from:",
      socket.id
    );

    if (!winnerTimer) {

      winnerTimer =
        setTimeout(
          finishGame,
          2000
        );

    }

  });

  socket.on("disconnect", () => {

    console.log(
      "Player disconnected:",
      socket.id
    );

  });

});

/* =========================
   FINISH GAME
========================= */

function finishGame() {

  if (!bingoStarted) {
    return;
  }

  bingoStarted = false;
  winnerTimer = null;

  const totalWinners =
    bingoWinners.length;

  if (totalWinners === 0) {
    return;
  }

  const prizePerWinner =
    PRIZE / totalWinners;

  console.log(
    "=========================="
  );

  console.log(
    "BINGO GAME FINISHED"
  );

  console.log(
    "Total winners:",
    totalWinners
  );

  console.log(
    "Total prize:",
    PRIZE
  );

  console.log(
    "Prize per winner:",
    prizePerWinner.toFixed(2)
  );

  console.log(
    "Winner IDs:",
    bingoWinners
  );

  console.log(
    "=========================="
  );

  io.emit(
    "winner",
    {

      winners:
        bingoWinners,

      totalWinners:
        totalWinners,

      totalPrize:
        PRIZE,

      prizePerWinner:
        prizePerWinner,

      message:
        "BINGO! " +
        totalWinners +
        " winner(s)!"

    }
  );

}

/* =========================
   SERVER
========================= */

server.listen(
  PORT,
  () => {

    console.log(
      "Bingo running at http://localhost:" +
      PORT
    );

  }
);