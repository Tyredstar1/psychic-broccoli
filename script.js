const STORAGE_KEY = "murderMysteryGames";
const state = {
  activeGameCode: null,
  hostGame: null,
  playerSession: null,
};

const selectors = {
  createGameForm: document.getElementById("create-game-form"),
  generateCodeBtn: document.getElementById("generate-code"),
  hostTools: document.getElementById("host-tools"),
  addPlayerForm: document.getElementById("add-player-form"),
  playerList: document.getElementById("player-list"),
  assignTargetsBtn: document.getElementById("assign-targets"),
  assignmentChain: document.getElementById("assignment-chain"),
  pendingMurders: document.getElementById("pending-murders"),
  confirmedMurders: document.getElementById("confirmed-murders"),
  correctAnswerForm: document.getElementById("correct-answer-form"),
  correctAnswerSelect: document.getElementById("correct-answer"),
  resultsSummary: document.getElementById("results-summary"),
  loginForm: document.getElementById("login-form"),
  playerDashboard: document.getElementById("player-dashboard"),
  playerGreeting: document.getElementById("player-greeting"),
  playerTarget: document.getElementById("player-target"),
  murderForm: document.getElementById("murder-form"),
  murderTarget: document.getElementById("murder-target"),
  murderNotes: document.getElementById("murder-notes"),
  murderPhoto: document.getElementById("murder-photo"),
  confirmations: document.getElementById("confirmations"),
  voteForm: document.getElementById("vote-form"),
  voteSelect: document.getElementById("vote-select"),
  voteStatus: document.getElementById("vote-status"),
  timeline: document.getElementById("timeline"),
  logoutBtn: document.getElementById("logout"),
};

const playerRowTemplate = document.getElementById("player-row-template");
const murderCardTemplate = document.getElementById("murder-card-template");

document.getElementById("current-year").textContent = new Date().getFullYear();

function loadGames() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn("Unable to parse stored games", error);
    return {};
  }
}

function saveGames(games) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
}

function ensureGameStructure(gameCode) {
  const games = loadGames();
  if (!games[gameCode]) {
    games[gameCode] = {
      code: gameCode,
      name: "",
      players: {},
      murders: [],
      votes: {},
      correctAnswer: "",
      createdAt: Date.now(),
    };
    saveGames(games);
  }
  return games[gameCode];
}

function updateGame(gameCode, transform) {
  const games = loadGames();
  if (!games[gameCode]) return;
  games[gameCode] = transform({ ...games[gameCode] });
  saveGames(games);
}

function getGame(gameCode) {
  const games = loadGames();
  return games[gameCode];
}

function randomCode(length = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function randomPin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function showHostTools(game) {
  selectors.hostTools.classList.toggle("hidden", !game);
  if (game) {
    selectors.correctAnswerSelect.innerHTML = "";
    selectors.correctAnswerSelect.append(new Option("Select culprit", ""));
    Object.values(game.players)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((player) => {
        selectors.correctAnswerSelect.append(new Option(player.name, player.name));
      });
    selectors.correctAnswerSelect.value = game.correctAnswer || "";
  }
}

function renderPlayerList(game) {
  selectors.playerList.innerHTML = "";
  const playerEntries = Object.values(game.players);
  if (!playerEntries.length) {
    selectors.playerList.textContent = "No players added yet.";
    return;
  }
  const fragment = document.createDocumentFragment();
  playerEntries
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((player) => {
      const node = playerRowTemplate.content.cloneNode(true);
      node.querySelector(".player-name").textContent = player.name;
      node.querySelector(".player-pin").textContent = `PIN: ${player.pin}`;
      node.querySelector(".player-target").textContent = player.target
        ? `Target: ${player.target}`
        : "No target yet";
      const removeBtn = node.querySelector(".remove-player");
      removeBtn.dataset.playerName = player.name;
      fragment.appendChild(node);
    });
  selectors.playerList.appendChild(fragment);
}

function removePlayer(gameCode, name) {
  updateGame(gameCode, (game) => {
    delete game.players[name];
    game.murders = game.murders.filter(
      (murder) => murder.murderer !== name && murder.victim !== name
    );
    delete game.votes[name];
    Object.values(game.votes).forEach((vote) => {
      if (vote.suspect === name) {
        vote.suspect = "";
      }
    });
    return game;
  });
  refreshHost(gameCode);
  refreshTimeline(gameCode);
}

function assignTargets(gameCode) {
  updateGame(gameCode, (game) => {
    const players = Object.values(game.players);
    if (players.length < 2) {
      alert("Add at least two players before assigning targets.");
      return game;
    }
    const shuffled = [...players];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    shuffled.forEach((player, index) => {
      const target = shuffled[(index + 1) % shuffled.length];
      game.players[player.name].target = target.name;
    });
    return game;
  });
  refreshHost(gameCode);
}

function renderAssignments(game) {
  selectors.assignmentChain.innerHTML = "";
  const players = Object.values(game.players);
  if (!players.length) return;
  const list = document.createElement("ol");
  list.className = "assignment-list";
  players
    .filter((player) => player.target)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((player) => {
      const item = document.createElement("li");
      item.innerHTML = `<strong>${player.name}</strong> ➜ <span>${player.target}</span>`;
      list.appendChild(item);
    });
  if (!list.children.length) {
    selectors.assignmentChain.textContent = "Targets have not been assigned yet.";
  } else {
    selectors.assignmentChain.appendChild(list);
  }
}

function renderMurders(game) {
  selectors.pendingMurders.innerHTML = "";
  selectors.confirmedMurders.innerHTML = "";
  const pending = game.murders.filter((murder) => !murder.confirmed);
  const confirmed = game.murders
    .filter((murder) => murder.confirmed)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (pending.length) {
    const header = document.createElement("h4");
    header.textContent = "Pending confirmation";
    selectors.pendingMurders.appendChild(header);
  }

  pending.forEach((murder) => {
    const card = murderCardTemplate.content.cloneNode(true);
    const article = card.querySelector(".murder-card");
    card.querySelector(".murder-card__title").textContent = `${murder.murderer} → ${murder.victim}`;
    card.querySelector(".murder-card__timestamp").textContent = formatDateTime(murder.timestamp);
    card.querySelector(".murder-card__notes").textContent = murder.notes || "No notes provided.";
    const image = card.querySelector(".murder-card__image");
    if (murder.photoData) {
      image.src = murder.photoData;
      image.classList.remove("hidden");
    } else {
      image.classList.add("hidden");
    }
    const actions = card.querySelector(".murder-card__actions");
    actions.textContent = "Awaiting victim confirmation";
    selectors.pendingMurders.appendChild(card);
  });

  if (confirmed.length) {
    const header = document.createElement("h4");
    header.textContent = "Confirmed";
    selectors.confirmedMurders.appendChild(header);
  }

  confirmed.forEach((murder) => {
    const card = murderCardTemplate.content.cloneNode(true);
    card.querySelector(".murder-card__title").textContent = `${murder.murderer} → ${murder.victim}`;
    card.querySelector(".murder-card__timestamp").textContent = `${formatDateTime(
      murder.timestamp
    )} (confirmed by ${murder.confirmedBy || "victim"})`;
    card.querySelector(".murder-card__notes").textContent = murder.notes || "No notes provided.";
    const image = card.querySelector(".murder-card__image");
    if (murder.photoData) {
      image.src = murder.photoData;
      image.classList.remove("hidden");
    } else {
      image.classList.add("hidden");
    }
    card.querySelector(".murder-card__actions").textContent = "Confirmed";
    selectors.confirmedMurders.appendChild(card);
  });
}

function renderResults(game) {
  selectors.resultsSummary.innerHTML = "";
  const votes = Object.entries(game.votes);
  if (!votes.length) {
    selectors.resultsSummary.textContent = "No votes recorded yet.";
    return;
  }
  const list = document.createElement("ul");
  list.className = "results-list";
  votes
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([player, vote]) => {
      const item = document.createElement("li");
      item.innerHTML = `<strong>${player}</strong> voted for <span>${vote.suspect || "Undecided"}</span>`;
      list.appendChild(item);
    });
  selectors.resultsSummary.appendChild(list);

  if (game.correctAnswer) {
    const winners = votes
      .filter(([, vote]) => vote.suspect === game.correctAnswer)
      .map(([name]) => name);
    const result = document.createElement("div");
    result.className = "results-highlight";
    result.innerHTML = `
      <p><strong>Correct culprit:</strong> ${game.correctAnswer}</p>
      <p><strong>Winners:</strong> ${winners.length ? winners.join(", ") : "No one guessed correctly"}</p>
    `;
    selectors.resultsSummary.appendChild(result);
  }
}

function syncPlayerDashboard(game) {
  const session = state.playerSession;
  if (!session || !game || session.gameCode !== game.code) return;
  const player = game.players[session.name];
  if (!player) {
    alert("You have been removed from the game.");
    logoutPlayer();
    return;
  }
  selectors.playerGreeting.textContent = `Welcome, ${player.name}!`;
  selectors.murderTarget.value = player.target || "Target not assigned yet";
  selectors.playerTarget.textContent = player.target
    ? `Your target is ${player.target}. Keep it secret!`
    : "Targets have not been assigned yet.";
  populateVoteOptions(game, player.name);
  renderPlayerVoteStatus(game, player.name);
  renderConfirmations(game, player.name);
}

function refreshHost(gameCode) {
  if (!gameCode) return;
  const game = getGame(gameCode);
  state.hostGame = game;
  if (!game) {
    selectors.hostTools.classList.add("hidden");
    return;
  }
  showHostTools(game);
  renderPlayerList(game);
  renderAssignments(game);
  renderMurders(game);
  renderResults(game);
  syncPlayerDashboard(game);
}

function refreshTimeline(gameCode) {
  selectors.timeline.innerHTML = "";
  const game = getGame(gameCode);
  if (!game || !game.murders.length) {
    selectors.timeline.textContent = "No confirmed murders yet.";
    return;
  }
  const confirmed = game.murders
    .filter((murder) => murder.confirmed)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (!confirmed.length) {
    selectors.timeline.textContent = "No confirmed murders yet.";
    return;
  }
  const fragment = document.createDocumentFragment();
  confirmed.forEach((murder) => {
    const card = murderCardTemplate.content.cloneNode(true);
    card.querySelector(".murder-card__title").textContent = `${murder.murderer} eliminated ${murder.victim}`;
    card.querySelector(".murder-card__timestamp").textContent = formatDateTime(murder.timestamp);
    card.querySelector(".murder-card__notes").textContent = murder.notes || "No notes provided.";
    const image = card.querySelector(".murder-card__image");
    if (murder.photoData) {
      image.src = murder.photoData;
      image.classList.remove("hidden");
    } else {
      image.classList.add("hidden");
    }
    card.querySelector(".murder-card__actions").textContent = `Confirmed by ${murder.confirmedBy || "victim"}`;
    fragment.appendChild(card);
  });
  selectors.timeline.appendChild(fragment);
}

function loginPlayer(gameCode, name, pin) {
  const game = getGame(gameCode);
  if (!game) {
    alert("Game code not found.");
    return;
  }
  const player = game.players[name];
  if (!player) {
    alert("Player not found. Ask the host to add you.");
    return;
  }
  if (player.pin !== pin) {
    alert("Incorrect PIN.");
    return;
  }
  state.playerSession = { gameCode, name };
  selectors.loginForm.classList.add("hidden");
  selectors.playerDashboard.classList.remove("hidden");
  selectors.playerGreeting.textContent = `Welcome, ${name}!`;
  selectors.murderTarget.value = player.target || "Target not assigned yet";
  selectors.playerTarget.textContent = player.target
    ? `Your target is ${player.target}. Keep it secret!`
    : "Targets have not been assigned yet.";
  populateVoteOptions(game, name);
  renderPlayerVoteStatus(game, name);
  renderConfirmations(game, name);
}

function logoutPlayer() {
  state.playerSession = null;
  selectors.loginForm.reset();
  selectors.playerDashboard.classList.add("hidden");
  selectors.loginForm.classList.remove("hidden");
  selectors.murderForm.reset();
  selectors.voteForm.reset();
  selectors.voteStatus.textContent = "";
  selectors.confirmations.innerHTML = "";
  selectors.playerGreeting.textContent = "";
  selectors.playerTarget.textContent = "";
  selectors.murderTarget.value = "";
}

function populateVoteOptions(game, selfName) {
  selectors.voteSelect.innerHTML = "";
  selectors.voteSelect.append(new Option("Select a suspect", ""));
  Object.values(game.players)
    .filter((player) => player.name !== selfName)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((player) => {
      selectors.voteSelect.append(new Option(player.name, player.name));
    });
}

function renderPlayerVoteStatus(game, name) {
  const vote = game.votes[name];
  if (!vote || !vote.suspect) {
    selectors.voteStatus.textContent = "You have not voted yet.";
  } else {
    selectors.voteStatus.textContent = `You voted for ${vote.suspect} on ${formatDateTime(vote.timestamp)}.`;
    selectors.voteSelect.value = vote.suspect;
  }
}

function renderConfirmations(game, playerName) {
  selectors.confirmations.innerHTML = "";
  const pending = game.murders.filter(
    (murder) => murder.victim === playerName && !murder.confirmed
  );
  if (!pending.length) {
    selectors.confirmations.textContent = "No murders to confirm.";
    return;
  }
  const fragment = document.createDocumentFragment();
  pending.forEach((murder) => {
    const card = murderCardTemplate.content.cloneNode(true);
    card.querySelector(".murder-card__title").textContent = `${murder.murderer} claims your demise`;
    card.querySelector(".murder-card__timestamp").textContent = formatDateTime(murder.timestamp);
    card.querySelector(".murder-card__notes").textContent = murder.notes || "No notes provided.";
    const image = card.querySelector(".murder-card__image");
    if (murder.photoData) {
      image.src = murder.photoData;
      image.classList.remove("hidden");
    } else {
      image.classList.add("hidden");
    }
    const actions = card.querySelector(".murder-card__actions");
    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "Confirm elimination";
    confirmBtn.className = "secondary";
    confirmBtn.addEventListener("click", () => confirmMurder(game.code, murder.id, playerName));
    actions.appendChild(confirmBtn);
    fragment.appendChild(card);
  });
  selectors.confirmations.appendChild(fragment);
}

function confirmMurder(gameCode, murderId, confirmedBy) {
  updateGame(gameCode, (game) => {
    const murder = game.murders.find((entry) => entry.id === murderId);
    if (murder) {
      murder.confirmed = true;
      murder.confirmedBy = confirmedBy;
      murder.confirmedAt = Date.now();
    }
    return game;
  });
  refreshHost(gameCode);
  refreshTimeline(gameCode);
  const session = state.playerSession;
  if (session && session.gameCode === gameCode) {
    const game = getGame(gameCode);
    renderConfirmations(game, session.name);
  }
}

function handleMurderSubmission(event) {
  event.preventDefault();
  if (!state.playerSession) return;
  const gameCode = state.playerSession.gameCode;
  const playerName = state.playerSession.name;
  const notes = selectors.murderNotes.value.trim();
  const target = selectors.murderTarget.value;
  if (!target || target === "Target not assigned yet") {
    alert("You don't have a target yet.");
    return;
  }

  const timestamp = Date.now();
  const submitMurder = (photoData) => {
    updateGame(gameCode, (game) => {
      const murder = {
        id: `${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
        murderer: playerName,
        victim: target,
        notes,
        timestamp,
        photoData,
        confirmed: false,
      };
      game.murders.push(murder);
      return game;
    });
    selectors.murderForm.reset();
    selectors.murderTarget.value = target;
    refreshHost(gameCode);
    refreshTimeline(gameCode);
  };

  const file = selectors.murderPhoto.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => submitMurder(e.target.result);
    reader.readAsDataURL(file);
  } else {
    submitMurder("");
  }
}

function handleVote(event) {
  event.preventDefault();
  if (!state.playerSession) return;
  const suspect = selectors.voteSelect.value;
  const { gameCode, name } = state.playerSession;
  updateGame(gameCode, (game) => {
    game.votes[name] = {
      suspect,
      timestamp: Date.now(),
    };
    return game;
  });
  const game = getGame(gameCode);
  renderPlayerVoteStatus(game, name);
  refreshHost(gameCode);
}

function handleCorrectAnswer(event) {
  event.preventDefault();
  if (!state.hostGame) return;
  const value = selectors.correctAnswerSelect.value;
  updateGame(state.hostGame.code, (game) => {
    game.correctAnswer = value;
    return game;
  });
  refreshHost(state.hostGame.code);
}

function handleCreateGame(event) {
  event.preventDefault();
  const formData = new FormData(selectors.createGameForm);
  let code = (formData.get("gameCode") || "").trim().toUpperCase();
  const name = (formData.get("gameName") || "").trim();
  if (!code) {
    code = randomCode();
    selectors.createGameForm.gameCode.value = code;
  }
  if (!/^[A-Z0-9]{3,6}$/.test(code)) {
    alert("Game code should be 3-6 letters or numbers.");
    return;
  }
  const game = ensureGameStructure(code);
  if (name) {
    updateGame(code, (existing) => ({ ...existing, name }));
  }
  state.activeGameCode = code;
  window.location.hash = `game=${code}`;
  refreshHost(code);
  refreshTimeline(code);
  selectors.hostTools.scrollIntoView({ behavior: "smooth", block: "start" });
}

function handleAddPlayer(event) {
  event.preventDefault();
  if (!state.activeGameCode) return;
  const formData = new FormData(selectors.addPlayerForm);
  const name = (formData.get("playerName") || "").trim();
  if (!name) return;
  updateGame(state.activeGameCode, (game) => {
    if (!game.players[name]) {
      game.players[name] = {
        name,
        pin: randomPin(),
        target: "",
      };
    }
    return game;
  });
  selectors.addPlayerForm.reset();
  refreshHost(state.activeGameCode);
}

function handleGenerateCode() {
  selectors.createGameForm.gameCode.value = randomCode();
}

function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(selectors.loginForm);
  const code = (formData.get("loginGameCode") || "").trim().toUpperCase();
  const name = (formData.get("loginName") || "").trim();
  const pin = (formData.get("loginPin") || "").trim();
  if (!code || !name || !pin) return;
  loginPlayer(code, name, pin);
}

function handleRemovePlayerButtons() {
  selectors.playerList.addEventListener("click", (event) => {
    const button = event.target.closest(".remove-player");
    if (!button) return;
    const name = button.dataset.playerName;
    if (!name) return;
    if (confirm(`Remove ${name} from the game?`)) {
      removePlayer(state.activeGameCode, name);
    }
  });
}

function bindEvents() {
  selectors.createGameForm.addEventListener("submit", handleCreateGame);
  selectors.generateCodeBtn.addEventListener("click", handleGenerateCode);
  selectors.addPlayerForm.addEventListener("submit", handleAddPlayer);
  selectors.assignTargetsBtn.addEventListener("click", () => {
    if (!state.activeGameCode) return;
    assignTargets(state.activeGameCode);
  });
  selectors.loginForm.addEventListener("submit", handleLogin);
  selectors.murderForm.addEventListener("submit", handleMurderSubmission);
  selectors.voteForm.addEventListener("submit", handleVote);
  selectors.correctAnswerForm.addEventListener("submit", handleCorrectAnswer);
  selectors.logoutBtn.addEventListener("click", logoutPlayer);
  handleRemovePlayerButtons();
}

function initFromHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const gameCode = params.get("game");
  if (gameCode) {
    selectors.createGameForm.gameCode.value = gameCode;
    const loginGameInput = document.getElementById("login-game-code");
    if (loginGameInput) {
      loginGameInput.value = gameCode;
    }
    state.activeGameCode = gameCode.toUpperCase();
    refreshHost(state.activeGameCode);
    refreshTimeline(state.activeGameCode);
  }
}

function init() {
  bindEvents();
  initFromHash();
}

init();
