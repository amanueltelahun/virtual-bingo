
require("dotenv").config();

const express = require("express");
const bcrypt = require("bcryptjs");
const http = require("http");
const { Server } = require("socket.io");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PRIZE = 100;
const CARTELA_PRICE = 10;
const MAX_CARTELAS = 400;

app.use(express.json());
app.use(express.static("public"));

/* TELEGRAM BOT */
let bot = null;

if (process.env.BOT_TOKEN) {
  bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      "🎱 Welcome to Virtual Bingo!\n\n" +
     "Play here: https://virtual-bingo-k0v7.onrender.com\n\n" +
      "💰 Demo Birr only"
    ).catch(console.error);
  });

  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      "🎱 Virtual Bingo Commands\n\n/start - Start bot\n/help - Help"
    ).catch(console.error);
  });

  bot.on("polling_error", (error) => {
    console.log("Telegram polling:", error.message);
  });

  console.log("Telegram Bot configured");
}
/* GAME STATE */
let bingoStarted = false;
let waitingForGame = false;
let drawnNumbers = [];
let bingoWinners = [];
let lobbySeconds = 60;
let totalCollected = 0;

let lobbyTimer = null;
let drawTimer = null;


/* DEMO WALLETS */
const playerBalances = {};
const playerTransactions = {};
const DEPOSIT_BONUS_RATE = 0.15;
const withdrawalRequests = [];
let nextWithdrawalId = 1;

/* CARTELA DATA */
const usedCartelaNumbers = new Set();
const playerCartelas = {};

function ensurePlayer(username) {
  const name = String(username || "").trim();

  if (!name || name.toLowerCase() === "admin") return null;

  if (playerBalances[name] === undefined) {
    playerBalances[name] = 100;
    playerTransactions[name] = [];
  }

  return name;
}

function addTransaction(username, type, amount) {
  if (!playerTransactions[username]) {
    playerTransactions[username] = [];
  }

  playerTransactions[username].unshift({
    type,
    amount: Number(amount),
    time: new Date().toLocaleString()
  });
}

/* GENERATE 5x5 BINGO CARD */
function generateCard() {
  const columns = [
    [1, 15],
    [16, 30],
    [31, 45],
    [46, 60],
    [61, 75]
  ];

  const card = Array.from({ length: 5 }, () => []);

  for (let c = 0; c < 5; c++) {
    const [min, max] = columns[c];
    const available = [];

    for (let n = min; n <= max; n++) available.push(n);

    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]];
    }

    for (let r = 0; r < 5; r++) {
      card[r][c] = available[r];
    }
  }

  card[2][2] = "FREE";
  return card;
}

/* ASSIGN UNIQUE CARTELA NUMBER */
function allocateCartela(username) {
  if (playerCartelas[username]) return playerCartelas[username];
  if (usedCartelaNumbers.size >= MAX_CARTELAS) return null;

  let number;

  do {
    number = Math.floor(Math.random() * MAX_CARTELAS) + 1;
  } while (usedCartelaNumbers.has(number));

  usedCartelaNumbers.add(number);

  const cartela = { number, card: generateCard() };
  playerCartelas[username] = cartela;

  console.log("Cartela assigned:", number, "to:", username);
  return cartela;
}

/* PLAYER REGISTRATION */
const registeredPlayers = {};

app.post("/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const phone = String(req.body.phone || "").trim();
  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirmPassword || "");

  if (!username || !phone || !password || !confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "Please fill in all fields."
    });
  }

  if (username.toLowerCase() === "admin") {
    return res.status(400).json({
      success: false,
      message: "This username is not available."
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 8 characters."
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "Passwords do not match."
    });
  }

  if (registeredPlayers[username.toLowerCase()]) {
    return res.status(409).json({
      success: false,
      message: "Username already exists."
    });
  }

  const phoneExists = Object.values(registeredPlayers).some(
    (player) => player.phone === phone
  );

  if (phoneExists) {
    return res.status(409).json({
      success: false,
      message: "Phone number already registered."
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  registeredPlayers[username.toLowerCase()] = {
    username,
    phone,
    passwordHash
  };

  ensurePlayer(username);

  return res.json({
    success: true,
    message: "Registration successful. You can now log in."
  });
});

/* LOGIN */
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const name = String(username || "").trim();

  if (!name || !password) {
    return res.status(400).json({
      success: false,
      message: "Username and password are required."
    });
  }

  if (name.toLowerCase() === "admin") {
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        message: "Incorrect admin password."
      });
    }

    return res.json({
      success: true,
      role: "admin",
      username: "admin"
    });
  }

  const player = registeredPlayers[name.toLowerCase()];

  if (!player) {
    return res.status(401).json({
      success: false,
      message: "Account not found. Please register first."
    });
  }

  const passwordMatches = await bcrypt.compare(
    password,
    player.passwordHash
  );

  if (!passwordMatches) {
    return res.status(401).json({
      success: false,
      message: "Incorrect password."
    });
  }

  ensurePlayer(player.username);

  return res.json({
    success: true,
    role: "player",
    username: player.username
  });
});



/* PLAYER BALANCE AND CARTELA */
app.get("/player/balance/:username", (req, res) => {
  const username = ensurePlayer(req.params.username);

  if (!username) {
    return res.status(400).json({
      success: false,
      message: "Invalid username."
    });
  }

  res.json({
    success: true,
    username,
    balance: playerBalances[username],
    transactions: playerTransactions[username],
    cartela: playerCartelas[username] || null,
    drawnNumbers: [...drawnNumbers],
    bingoStarted,
    waitingForGame,
    lobbySeconds
  });
});

/* ADMIN TRANSFERS DEMO BIRR */
app.post("/admin/send-balance", (req, res) => {
  const { adminPassword, username, amount } = req.body;
  const player = ensurePlayer(username);
  const value = Number(amount);

  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "Admin password is incorrect."
    });
  }

  if (!player || !Number.isFinite(value) || value <= 0) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid player and positive amount."
    });
  }

  playerBalances[player] += value;
  addTransaction(player, "Admin Transfer", value);

  const update = {
    username: player,
    balance: playerBalances[player],
    transactions: playerTransactions[player]
  };

  io.emit("balanceUpdated", update);

  res.json({
    success: true,
    message: "Demo Birr sent successfully.",
    ...update
  });
});

/* BUY CARTELA *//* AVAILABLE CARTELA NUMBERS */
app.get("/cartela/available", (req, res) => {
  const available = [];
  for (let number = 1; number <= MAX_CARTELAS; number++) {
    if (!usedCartelaNumbers.has(number)) available.push(number);
  }
  res.json({ success: true, available });
});
app.post("/cartela", (req, res) => {
  const username = ensurePlayer(req.body.username);

  if (!username) {
    return res.status(400).json({
      success: false,
      message: "Please log in first."
    });
  }

if (bingoStarted) {
  return res.status(400).json({
    success: false,
    message: "Please wait until the next round."
  });
}

  if (playerCartelas[username]) {
    return res.status(400).json({
      success: false,
      message: "You already have a Cartela."
    });
  }

  if (usedCartelaNumbers.size >= MAX_CARTELAS) {
    return res.status(400).json({
      success: false,
      message: "All 400 Cartelas have been assigned."
    });
  }

  if (playerBalances[username] < CARTELA_PRICE) {
    return res.status(400).json({
      success: false,
      message: "You need 10 Demo Birr."
    });
  }

  const cartela = allocateCartela(username);

  if (!cartela) {
    return res.status(400).json({
      success: false,
      message: "No Cartelas available."
    });
  }

 playerBalances[username] -= CARTELA_PRICE;

if (!waitingForGame && !bingoStarted) {
  totalCollected = 0;
}

totalCollected += CARTELA_PRICE;

addTransaction(
  username,
  "Cartela Purchase",
  -CARTELA_PRICE
);
  if (!waitingForGame) {
    waitingForGame = true;
    lobbySeconds = 60;

    io.emit("waitingForGame", lobbySeconds);

    lobbyTimer = setInterval(() => {
      lobbySeconds--;
      io.emit("waitingForGame", lobbySeconds);

      if (lobbySeconds <= 0) {
        clearInterval(lobbyTimer);
        lobbyTimer = null;
        startAutomaticGame();
      }
    }, 1000);
  }

  res.json({
    success: true,
    message: "Cartela purchased successfully.",
    balance: playerBalances[username],
    transactions: playerTransactions[username],
    cartela,
    drawnNumbers: [...drawnNumbers]
  });
});


/* PLAYER WITHDRAWAL REQUEST */
app.post("/withdraw/request", (req, res) => {
  const username = ensurePlayer(req.body.username);
  const amount = Number(req.body.amount);

  if (!username) {
    return res.status(400).json({
      success: false,
      message: "Please log in first."
    });
  }

  if (!Number.isFinite(amount) || amount < 10) {
    return res.status(400).json({
      success: false,
      message: "Minimum withdrawal is 10 Demo Birr."
    });
  }

  if (amount > playerBalances[username]) {
    return res.status(400).json({
      success: false,
      message: "Insufficient Demo Birr balance."
    });
  }

  playerBalances[username] -= amount;
  addTransaction(username, "Withdrawal Pending", -amount);

  const request = {
    id: nextWithdrawalId++,
    username,
    amount,
    status: "Pending",
    createdAt: new Date().toLocaleString()
  };

  withdrawalRequests.push(request);

  io.emit("balanceUpdated", {
    username,
    balance: playerBalances[username],
    transactions: playerTransactions[username]
  });

  res.json({
    success: true,
    message: "Withdrawal request submitted for admin review.",
    request,
    balance: playerBalances[username]
  });
});


/* ADMIN VIEW WITHDRAWAL REQUESTS */
app.post("/admin/withdrawals", (req, res) => {
  if (req.body.adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "Admin password is incorrect."
    });
  }

  res.json({
    success: true,
    requests: withdrawalRequests
  });
});

/* ADMIN APPROVE OR REJECT WITHDRAWAL */
app.post("/admin/withdrawals/:id/review", (req, res) => {
  if (req.body.adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "Admin password is incorrect."
    });
  }

  const request = withdrawalRequests.find(
    (item) => item.id === Number(req.params.id)
  );

  if (!request) {
    return res.status(404).json({
      success: false,
      message: "Withdrawal request not found."
    });
  }

  if (request.status !== "Pending") {
    return res.status(400).json({
      success: false,
      message: "This request has already been reviewed."
    });
  }

  const action = String(req.body.action || "").toLowerCase();

  if (action === "approve") {
    request.status = "Approved";
  } else if (action === "reject") {
    request.status = "Rejected";

    playerBalances[request.username] += request.amount;
    addTransaction(
      request.username,
      "Withdrawal Rejected - Refund",
      request.amount
    );

    io.emit("balanceUpdated", {
      username: request.username,
      balance: playerBalances[request.username],
      transactions: playerTransactions[request.username]
    });
  } else {
    return res.status(400).json({
      success: false,
      message: "Action must be approve or reject."
    });
  }

  res.json({
    success: true,
    message: "Withdrawal " + request.status.toLowerCase() + ".",
    request
  });
});

/* START GAME */
function startAutomaticGame() {
  if (drawTimer) clearInterval(drawTimer);
  if (lobbyTimer) clearInterval(lobbyTimer);

  lobbyTimer = null;
  drawTimer = null;

  waitingForGame = false;
  bingoStarted = true;
  drawnNumbers = [];
  bingoWinners = [];

  console.log("======================");
  console.log("BINGO STARTED");
  console.log("Total collected:", totalCollected);
  console.log("======================");

  io.emit("bingoStarted");

  drawTimer = setInterval(() => {
    if (bingoStarted) drawAutomaticNumber();
  }, 3000);
}

/* CHECK REAL BINGO */
function hasBingo(card) {
  if (!card || card.length !== 5) return false;

  const marked = (value) =>
    value === "FREE" || drawnNumbers.includes(Number(value));

  for (let r = 0; r < 5; r++) {
    if (card[r].every(marked)) return true;
  }

  for (let c = 0; c < 5; c++) {
    if (card.every((row) => marked(row[c]))) return true;
  }

  if ([0, 1, 2, 3, 4].every((i) => marked(card[i][i]))) {
    return true;
  }

  if ([0, 1, 2, 3, 4].every((i) => marked(card[i][4 - i]))) {
    return true;
  }

  return false;
}

/* DRAW UNIQUE NUMBERS AND FIND WINNERS */
function drawAutomaticNumber() {
  if (!bingoStarted) return;

  if (drawnNumbers.length >= 75) {
    stopAutomaticGame();
    return;
  }

  let number;

  do {
    number = Math.floor(Math.random() * 75) + 1;
  } while (drawnNumbers.includes(number));

  drawnNumbers.push(number);

  console.log("Number drawn:", number);
  io.emit("number", number);

  const winners = Object.keys(playerCartelas).filter(
    (username) =>
      !bingoWinners.includes(username) &&
      hasBingo(playerCartelas[username].card)
  );

  if (winners.length > 0) {
    finishGame(winners);
    return;
  }

  if (drawnNumbers.length >= 75) stopAutomaticGame();
}

/* ADMIN START */
app.post("/start", (req, res) => {
  if (bingoStarted) {
    return res.json({
      success: false,
      message: "Bingo is already running."
    });
  }

  startAutomaticGame();

  res.json({
    success: true,
    message: "Bingo started."
  });
});

/* ADMIN DRAW */
app.post("/draw", (req, res) => {
  if (!bingoStarted) {
    return res.status(400).json({
      success: false,
      message: "Bingo is not running."
    });
  }

  drawAutomaticNumber();
  res.json({ success: true });
});

/* STOP GAME */
app.post("/stop", (req, res) => {
  stopAutomaticGame();
  res.json({ success: true, message: "Bingo stopped." });
});

function stopAutomaticGame() {
  bingoStarted = false;
  waitingForGame = false;

  if (drawTimer) clearInterval(drawTimer);
  if (lobbyTimer) clearInterval(lobbyTimer);

  drawTimer = null;
  lobbyTimer = null;

  io.emit("bingoStopped");
  console.log("BINGO STOPPED");
}

/* SOCKET CONNECTION */
io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
  });
});

/* FINISH GAME */
function finishGame(winners = []) {
  if (!bingoStarted) return;

  bingoStarted = false;
  waitingForGame = false;

  if (drawTimer) clearInterval(drawTimer);
  if (lobbyTimer) clearInterval(lobbyTimer);

  drawTimer = null;
  lobbyTimer = null;

  if (winners.length === 0) {
    io.emit("bingoStopped");
    console.log("No winner. Game stopped.");
    return;
  }

  bingoWinners = [...winners];

const prizePool = Number(
  (totalCollected * 0.85).toFixed(2)
);

const prizePerWinner = Number(
  (prizePool / winners.length).toFixed(2)
);

  winners.forEach((username) => {
    ensurePlayer(username);

    playerBalances[username] += prizePerWinner;
    addTransaction(username, "BINGO Prize", prizePerWinner);

    io.emit("balanceUpdated", {
      username,
      balance: playerBalances[username],
      transactions: playerTransactions[username]
    });

    console.log(
      "BINGO WINNER:",
      username,
      "| Cartela:",
      playerCartelas[username].number,
      "| Prize:",
      prizePerWinner
    );
  });


io.emit("winner", {
  winners,
  totalWinners: winners.length,
  totalPrize: prizePool,
  prize: prizePerWinner,
  prizePerWinner,
  cartelas: winners.map(username => ({
    username,
    cartelaNumber: playerCartelas[username]?.number ?? null
  })),
  message: "BINGO! Winner: " + winners.join(", ")
});

  io.emit("bingoStopped");
  console.log("BINGO FINISHED");
}

/* SERVER */
server.listen(PORT, () => {
  console.log("Bingo running at http://localhost:" + PORT);
});