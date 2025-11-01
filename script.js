const API_BASE = window.__MYSTERY_API_BASE__ || "";
const ADMIN_PASSWORD = "CLUEKEEPER";
const SESSION_KEY = "murderMysteryPlayerSession";
const ADMIN_SESSION_KEY = "murderMysteryAdmin";

const GAMES_ENDPOINT = `${API_BASE}/api/games`;
const GAME_STREAM_ENDPOINT = `${API_BASE}/api/stream`;

const PHASES = ["murders", "investigation", "voting", "results"];
const PHASE_LABELS = {
  murders: "Murders in Progress",
  investigation: "Investigation",
  voting: "Voting",
  results: "Results Revealed",
};

const state = {
  selectedGameCode: null,
  playerSession: null,
  adminAuthorized: false,
  adminGameCode: null,
  revealPins: false,
};

const dataStore = {
  cache: {},
  ready: false,
};

let refreshPromise = null;
let syncScheduled = false;
let allowSync = false;
let pendingSync = false;

function normalizeGame(raw = {}) {
  const base = {
    code: raw.code || "",
    name: raw.name || "",
    players: raw.players ? { ...raw.players } : {},
    murders: Array.isArray(raw.murders) ? [...raw.murders] : [],
    votes: raw.votes ? { ...raw.votes } : {},
    correctAnswer: raw.correctAnswer || "",
    started: raw.started ?? false,
    phase: PHASES.includes(raw.phase) ? raw.phase : "murders",
    createdAt: raw.createdAt || Date.now(),
  };

  Object.entries(base.players).forEach(([name, player]) => {
    base.players[name] = {
      name: player.name || name,
      pin: player.pin || randomPin(),
      target: player.target || "",
    };
  });

  base.murders = base.murders.map((murder) => ({
    id: murder.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    murderer: murder.murderer || "",
    victim: murder.victim || "",
    notes: murder.notes || "",
    timestamp: murder.timestamp || Date.now(),
    photoData: murder.photoData || "",
    confirmed: Boolean(murder.confirmed),
    confirmedBy: murder.confirmedBy || "",
    confirmedAt: murder.confirmedAt || null,
  }));

  Object.entries(base.votes).forEach(([name, vote]) => {
    base.votes[name] = {
      suspect: vote.suspect || "",
      timestamp: vote.timestamp || Date.now(),
    };
  });

  return base;
}

function scheduleSync() {
  if (!allowSync) {
    pendingSync = true;
    return;
  }
  if (syncScheduled) return;
  syncScheduled = true;
  Promise.resolve()
    .then(() => handleServerSync())
    .catch((error) => {
      console.error("Unable to synchronize views", error);
    })
    .finally(() => {
      syncScheduled = false;
    });
}

function applySnapshot(gamesArray = []) {
  const snapshot = {};
  gamesArray.forEach((game) => {
    if (game && game.code) {
      snapshot[game.code] = normalizeGame({ ...game, code: game.code });
    }
  });
  dataStore.cache = snapshot;
  dataStore.ready = true;
  scheduleSync();
}

async function refreshGamesFromServer() {
  try {
    const response = await fetch(GAMES_ENDPOINT, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    const payload = await response.json();
    const games = Array.isArray(payload.games) ? payload.games : [];
    applySnapshot(games);
  } catch (error) {
    console.error("Failed to refresh games from server", error);
    if (!dataStore.ready) {
      dataStore.cache = {};
      dataStore.ready = true;
    }
    throw error;
  }
  return dataStore.cache;
}

async function ensureGamesLoaded() {
  if (dataStore.ready) {
    return dataStore.cache;
  }
  if (!refreshPromise) {
    refreshPromise = refreshGamesFromServer().finally(() => {
      refreshPromise = null;
    });
  }
  try {
    await refreshPromise;
  } catch (error) {
    console.warn("Continuing with empty game cache after load failure");
  }
  return dataStore.cache;
}

async function loadGames() {
  await ensureGamesLoaded();
  return { ...dataStore.cache };
}

async function saveGameToServer(code, game) {
  const response = await fetch(`${GAMES_ENDPOINT}/${encodeURIComponent(code)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...game, code }),
  });
  if (!response.ok) {
    throw new Error(`Unable to save game ${code}: ${response.status}`);
  }
  const payload = await response.json();
  const saved = normalizeGame({ ...payload.game, code });
  dataStore.cache[code] = saved;
  return saved;
}

async function ensureGame(code) {
  if (!code) {
    throw new Error("Game code is required");
  }
  await ensureGamesLoaded();
  if (!dataStore.cache[code]) {
    const created = normalizeGame({ code });
    dataStore.cache[code] = created;
    try {
      await saveGameToServer(code, created);
    } catch (error) {
      delete dataStore.cache[code];
      throw error;
    }
    scheduleSync();
  }
  return dataStore.cache[code];
}

async function updateGame(code, transform) {
  await ensureGamesLoaded();
  if (!dataStore.cache[code]) return null;
  const current = normalizeGame(dataStore.cache[code]);
  let updated;
  try {
    updated = normalizeGame(transform({ ...current }));
  } catch (error) {
    throw error;
  }
  dataStore.cache[code] = updated;
  try {
    await saveGameToServer(code, updated);
  } catch (error) {
    console.error("Failed to persist game update", error);
    await refreshGamesFromServer().catch(() => undefined);
    throw error;
  }
  scheduleSync();
  return updated;
}

async function getGame(code) {
  await ensureGamesLoaded();
  if (!code) return null;
  if (dataStore.cache[code]) {
    return normalizeGame(dataStore.cache[code]);
  }
  try {
    const response = await fetch(`${GAMES_ENDPOINT}/${encodeURIComponent(code)}`);
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const game = normalizeGame({ ...payload.game, code });
    dataStore.cache[code] = game;
    scheduleSync();
    return game;
  } catch (error) {
    console.error("Failed to fetch game", error);
    return null;
  }
}

async function listGames() {
  const games = await loadGames();
  return Object.values(games)
    .map((game) => normalizeGame(game))
    .sort((a, b) => b.createdAt - a.createdAt || a.code.localeCompare(b.code));
}

function initRealtimeUpdates() {
  if (window.EventSource) {
    let source = null;
    const connect = () => {
      if (source) {
        source.close();
      }
      source = new EventSource(GAME_STREAM_ENDPOINT, { withCredentials: false });
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload && payload.type === "sync" && Array.isArray(payload.games)) {
            applySnapshot(payload.games);
          }
        } catch (error) {
          console.error("Failed to process realtime update", error);
        }
      };
      source.onerror = () => {
        source?.close();
        setTimeout(connect, 3000);
      };
    };
    connect();
  } else {
    setInterval(() => {
      refreshGamesFromServer().catch(() => undefined);
    }, 5000);
  }
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

function phaseLabel(phase) {
  return PHASE_LABELS[phase] || "Unknown";
}

function phaseIndex(phase) {
  return Math.max(0, PHASES.indexOf(phase));
}

function nextPhase(current) {
  const index = phaseIndex(current);
  return PHASES[Math.min(PHASES.length - 1, index + 1)];
}

function savePlayerSession(session) {
  if (!session) {
    sessionStorage.removeItem(SESSION_KEY);
    state.playerSession = null;
    return;
  }
  state.playerSession = session;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function loadPlayerSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.gameCode && parsed.name) {
      state.playerSession = parsed;
      state.selectedGameCode = parsed.gameCode;
      return parsed;
    }
  } catch (error) {
    console.warn("Unable to parse player session", error);
  }
  return null;
}

function saveAdminSession(enabled) {
  if (enabled) {
    state.adminAuthorized = true;
    sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
  } else {
    state.adminAuthorized = false;
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
  }
}

function loadAdminSession() {
  if (sessionStorage.getItem(ADMIN_SESSION_KEY)) {
    state.adminAuthorized = true;
  }
}

function initCommon() {
  const yearEl = document.getElementById("current-year");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
}

async function handleServerSync() {
  if (document.body.dataset.view === "player") {
    await renderGamesList();
    if (state.selectedGameCode) {
      const game = await getGame(state.selectedGameCode);
      if (!game) {
        resetPlayerSelection();
        return;
      }
      renderSelectedGame(game);
      if (state.playerSession) {
        syncPlayerDashboard(game);
      }
    }
  }
  if (document.body.dataset.view === "admin") {
    await renderAdminGames();
    if (state.adminGameCode) {
      const game = await getGame(state.adminGameCode);
      if (game) {
        renderGameManagement(game);
      }
    }
  }
}

// Player Experience
let playerSelectors = null;
let gameCardTemplate = null;
let playerMurderTemplate = null;

async function initPlayerView() {
  playerSelectors = {
    gamesList: document.getElementById("games-list"),
    noGames: document.getElementById("no-games"),
    refreshGames: document.getElementById("refresh-games"),
    gameEntry: document.getElementById("game-entry"),
    selectedTitle: document.getElementById("selected-game-title"),
    selectedCode: document.getElementById("selected-game-code"),
    selectedStatus: document.getElementById("selected-game-status"),
    selectedPhase: document.getElementById("selected-game-phase"),
    clearSelection: document.getElementById("clear-selection"),
    playerSelect: document.getElementById("player-select"),
    playerPinForm: document.getElementById("player-pin-form"),
    playerPin: document.getElementById("player-pin"),
    addPlayerSection: document.getElementById("add-player-section"),
    addPlayerButton: document.getElementById("show-add-player"),
    addPlayerForm: document.getElementById("add-player-form"),
    newPlayerName: document.getElementById("new-player-name"),
    newPlayerFeedback: document.getElementById("new-player-feedback"),
    playerDashboard: document.getElementById("player-dashboard"),
    playerGreeting: document.getElementById("player-greeting"),
    playerTarget: document.getElementById("player-target"),
    playerPhase: document.getElementById("player-phase"),
    murderForm: document.getElementById("murder-form"),
    murderTarget: document.getElementById("murder-target"),
    murderNotes: document.getElementById("murder-notes"),
    confirmations: document.getElementById("confirmations"),
    timeline: document.getElementById("timeline"),
    voteForm: document.getElementById("vote-form"),
    voteSelect: document.getElementById("vote-select"),
    voteStatus: document.getElementById("vote-status"),
    resultsSummary: document.getElementById("results-summary"),
    logout: document.getElementById("logout"),
  };

  gameCardTemplate = document.getElementById("game-card-template");
  playerMurderTemplate = document.getElementById("murder-card-template");

  playerSelectors.refreshGames?.addEventListener("click", () => {
    refreshGamesFromServer().catch(() => undefined);
  });
  playerSelectors.clearSelection?.addEventListener("click", resetPlayerSelection);
  playerSelectors.playerSelect?.addEventListener("change", handlePlayerSelect);
  playerSelectors.playerPinForm?.addEventListener("submit", handlePlayerLogin);
  playerSelectors.addPlayerButton?.addEventListener("click", toggleAddPlayerForm);
  playerSelectors.addPlayerForm?.addEventListener("submit", handleCreatePlayer);
  playerSelectors.logout?.addEventListener("click", handleLogout);
  playerSelectors.murderForm?.addEventListener("submit", handleMurderSubmission);
  playerSelectors.voteForm?.addEventListener("submit", handleVoteSubmission);

  await renderGamesList();
  const storedSession = loadPlayerSession();
  if (storedSession) {
    const game = await getGame(storedSession.gameCode);
    if (game && game.players[storedSession.name]) {
      renderSelectedGame(game);
      enterPlayerDashboard(game, storedSession.name);
    } else {
      savePlayerSession(null);
    }
  }
}

async function renderGamesList() {
  if (!playerSelectors) return;
  playerSelectors.gamesList.innerHTML = "";
  try {
    const games = await listGames();
    if (!games.length) {
      playerSelectors.noGames?.classList.remove("hidden");
      return;
    }
    playerSelectors.noGames?.classList.add("hidden");
    const fragment = document.createDocumentFragment();
    games.forEach((game) => {
      const node = gameCardTemplate.content.cloneNode(true);
      const button = node.querySelector(".game-card");
      button.dataset.code = game.code;
      node.querySelector(".game-card__name").textContent = game.name || `Game ${game.code}`;
      node.querySelector(".game-card__code").textContent = `Code: ${game.code}`;
      node.querySelector(".game-card__status").textContent = game.started
        ? `Phase: ${phaseLabel(game.phase)}`
        : "Open for players";
      button.addEventListener("click", () => {
        selectGame(game.code);
      });
      fragment.appendChild(node);
    });
    playerSelectors.gamesList.appendChild(fragment);
  } catch (error) {
    console.error("Unable to render games list", error);
    playerSelectors.noGames?.classList.remove("hidden");
    if (playerSelectors.noGames) {
      playerSelectors.noGames.textContent = "Unable to reach the game server. Try again soon.";
    }
  }
}

async function selectGame(code) {
  const game = await getGame(code);
  if (!game) return;
  state.selectedGameCode = code;
  savePlayerSession(null);
  renderSelectedGame(game);
}

function resetPlayerSelection() {
  state.selectedGameCode = null;
  savePlayerSession(null);
  if (!playerSelectors) return;
  playerSelectors.gameEntry?.classList.add("hidden");
  playerSelectors.playerPinForm?.classList.add("hidden");
  playerSelectors.playerDashboard?.classList.add("hidden");
  playerSelectors.playerSelect.value = "";
  playerSelectors.newPlayerFeedback.textContent = "";
  playerSelectors.addPlayerForm?.classList.add("hidden");
  playerSelectors.addPlayerSection?.classList.add("hidden");
}

function renderSelectedGame(game) {
  if (!playerSelectors) return;
  playerSelectors.gameEntry?.classList.remove("hidden");
  playerSelectors.selectedTitle.textContent = game.name || "Untitled Mystery";
  playerSelectors.selectedCode.textContent = game.code;
  playerSelectors.selectedStatus.textContent = game.started ? "In progress" : "Accepting players";
  playerSelectors.selectedPhase.textContent = phaseLabel(game.phase);
  playerSelectors.selectedPhase.classList.toggle("hidden", !game.started && game.phase === "murders");

  populatePlayerOptions(game);
  updateAddPlayerVisibility(game);
  updatePhaseVisibility(game.phase);

  if (state.playerSession && state.playerSession.gameCode === game.code) {
    enterPlayerDashboard(game, state.playerSession.name);
  } else {
    playerSelectors.playerDashboard?.classList.add("hidden");
  }
}

function populatePlayerOptions(game) {
  playerSelectors.playerSelect.innerHTML = "";
  playerSelectors.playerSelect.append(new Option("Select your name", ""));
  Object.values(game.players)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((player) => {
      playerSelectors.playerSelect.append(new Option(player.name, player.name));
    });
  playerSelectors.playerPinForm?.classList.add("hidden");
  playerSelectors.playerPin.value = "";
}

function updateAddPlayerVisibility(game) {
  if (!playerSelectors.addPlayerSection) return;
  if (game.started) {
    playerSelectors.addPlayerSection.classList.remove("hidden");
    playerSelectors.addPlayerButton.textContent = "Registration locked";
    playerSelectors.addPlayerButton.disabled = true;
    playerSelectors.addPlayerForm.classList.add("hidden");
    playerSelectors.newPlayerFeedback.textContent = "The host has started the game. New players cannot join.";
  } else {
    playerSelectors.addPlayerSection.classList.remove("hidden");
    playerSelectors.addPlayerButton.textContent = "Add New Player";
    playerSelectors.addPlayerButton.disabled = false;
    playerSelectors.newPlayerFeedback.textContent = "";
  }
}

function toggleAddPlayerForm() {
  if (!playerSelectors) return;
  if (playerSelectors.addPlayerButton.disabled) return;
  playerSelectors.addPlayerForm.classList.toggle("hidden");
  if (!playerSelectors.addPlayerForm.classList.contains("hidden")) {
    playerSelectors.newPlayerName.focus();
  }
}

function handlePlayerSelect() {
  if (!playerSelectors) return;
  const name = playerSelectors.playerSelect.value;
  if (name) {
    playerSelectors.playerPinForm.classList.remove("hidden");
    playerSelectors.playerPin.focus();
  } else {
    playerSelectors.playerPinForm.classList.add("hidden");
    playerSelectors.playerPin.value = "";
  }
}

async function handleCreatePlayer(event) {
  event.preventDefault();
  if (!state.selectedGameCode) return;
  const name = playerSelectors.newPlayerName.value.trim();
  if (!name) return;
  let game;
  try {
    game = await updateGame(state.selectedGameCode, (current) => {
      if (current.players[name]) {
        throw new Error("Player exists");
      }
      current.players[name] = {
        name,
        pin: randomPin(),
        target: "",
      };
      return current;
    });
  } catch (error) {
    playerSelectors.newPlayerFeedback.textContent = "That name is already taken. Choose another.";
    return;
  }
  if (!game) return;
  const pin = game.players[name].pin;
  playerSelectors.newPlayerFeedback.textContent = `Welcome, ${name}! Your secret PIN is ${pin}. Memorize it now.`;
  playerSelectors.addPlayerForm.reset();
  playerSelectors.addPlayerForm.classList.add("hidden");
  populatePlayerOptions(game);
}

async function handlePlayerLogin(event) {
  event.preventDefault();
  if (!state.selectedGameCode) return;
  const game = await getGame(state.selectedGameCode);
  if (!game) return;
  const name = playerSelectors.playerSelect.value;
  const pin = playerSelectors.playerPin.value.trim();
  if (!name || !pin) return;
  const player = game.players[name];
  if (!player) {
    alert("Player not found. Ask the host to add you.");
    return;
  }
  if (player.pin !== pin) {
    alert("Incorrect PIN. Try again.");
    playerSelectors.playerPin.focus();
    return;
  }
  enterPlayerDashboard(game, name);
  savePlayerSession({ gameCode: game.code, name });
}

function enterPlayerDashboard(game, name) {
  if (!playerSelectors) return;
  state.playerSession = { gameCode: game.code, name };
  playerSelectors.playerDashboard.classList.remove("hidden");
  playerSelectors.playerGreeting.textContent = `Welcome, ${name}!`;
  playerSelectors.playerPhase.textContent = phaseLabel(game.phase);
  const player = game.players[name];
  playerSelectors.playerTarget.textContent = player.target
    ? `Your target is ${player.target}. Keep it secret!`
    : "Targets have not been assigned yet.";
  playerSelectors.murderTarget.value = player.target || "Target not assigned";
  playerSelectors.playerPin.value = "";
  updatePhaseVisibility(game.phase);
  syncPlayerDashboard(game);
}

function updatePhaseVisibility(phase) {
  document.querySelectorAll("[data-phase]").forEach((section) => {
    const phases = section.dataset.phase.split(/\s+/);
    section.classList.toggle("hidden", !phases.includes(phase));
  });
}

function syncPlayerDashboard(game) {
  if (!playerSelectors || !state.playerSession) return;
  const { name } = state.playerSession;
  const player = game.players[name];
  if (!player) {
    alert("You have been removed from the game.");
    handleLogout();
    return;
  }
  playerSelectors.playerPhase.textContent = phaseLabel(game.phase);
  playerSelectors.playerTarget.textContent = player.target
    ? `Your target is ${player.target}. Keep it secret!`
    : "Targets have not been assigned yet.";
  playerSelectors.murderTarget.value = player.target || "Target not assigned";
  updatePhaseVisibility(game.phase);
  renderConfirmations(game, name);
  renderTimeline(game);
  renderVoteOptions(game, name);
  renderVoteStatus(game, name);
  renderPlayerResults(game);
}

function handleLogout() {
  savePlayerSession(null);
  if (!playerSelectors) return;
  playerSelectors.playerDashboard.classList.add("hidden");
  playerSelectors.playerPinForm.classList.add("hidden");
  playerSelectors.playerSelect.value = "";
  playerSelectors.playerPin.value = "";
  playerSelectors.murderForm?.reset();
  playerSelectors.voteForm?.reset();
  playerSelectors.confirmations.innerHTML = "";
  playerSelectors.timeline.innerHTML = "";
  playerSelectors.voteStatus.textContent = "";
  playerSelectors.resultsSummary.innerHTML = "";
}

function renderConfirmations(game, playerName) {
  playerSelectors.confirmations.innerHTML = "";
  const pending = game.murders.filter((murder) => murder.victim === playerName && !murder.confirmed);
  if (!pending.length) {
    playerSelectors.confirmations.textContent = "No murders to confirm.";
    return;
  }
  const fragment = document.createDocumentFragment();
  pending.forEach((murder) => {
    const node = playerMurderTemplate.content.cloneNode(true);
    const claimedMurderer = murder.murderer || "Someone";
    node.querySelector(".murder-card__title").textContent = `${claimedMurderer} claims your demise`;
    node.querySelector(".murder-card__timestamp").textContent = formatDateTime(murder.timestamp);
    node.querySelector(".murder-card__notes").textContent = murder.notes || "No notes provided.";
    const image = node.querySelector(".murder-card__image");
    if (murder.photoData) {
      image.src = murder.photoData;
      image.classList.remove("hidden");
    } else {
      image.classList.add("hidden");
    }
    const actions = node.querySelector(".murder-card__actions");
    actions.innerHTML = "";
    const helper = document.createElement("p");
    helper.className = "muted";
    helper.textContent = "Select the culprit and add your own evidence before confirming.";
    actions.appendChild(helper);

    const murdererField = document.createElement("div");
    murdererField.className = "murder-confirm__field";
    const murdererLabel = document.createElement("label");
    murdererLabel.setAttribute("for", `confirm-murderer-${murder.id}`);
    murdererLabel.textContent = "Who eliminated you?";
    murdererField.appendChild(murdererLabel);
    const murdererSelect = document.createElement("select");
    murdererSelect.id = `confirm-murderer-${murder.id}`;
    murdererSelect.className = "murder-confirm__select";
    murdererSelect.append(new Option("Select a player", ""));
    Object.values(game.players)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((player) => {
        murdererSelect.append(new Option(player.name, player.name));
      });
    murdererSelect.value = murder.murderer || "";
    murdererField.appendChild(murdererSelect);
    actions.appendChild(murdererField);

    const photoField = document.createElement("div");
    photoField.className = "murder-confirm__field";
    const photoLabel = document.createElement("label");
    photoLabel.setAttribute("for", `confirm-photo-${murder.id}`);
    photoLabel.textContent = "Upload your evidence";
    photoField.appendChild(photoLabel);
    const photoInput = document.createElement("input");
    photoInput.id = `confirm-photo-${murder.id}`;
    photoInput.type = "file";
    photoInput.accept = "image/*";
    photoField.appendChild(photoInput);
    actions.appendChild(photoField);

    const button = document.createElement("button");
    button.textContent = "Confirm elimination";
    button.className = "secondary";
    button.addEventListener("click", () => {
      if (!murdererSelect.value) {
        alert("Select who eliminated you before confirming.");
        murdererSelect.focus();
        return;
      }
      const file = photoInput.files && photoInput.files[0];
      if (!file && !murder.photoData) {
        alert("Upload evidence before confirming your elimination.");
        photoInput.focus();
        return;
      }
      const finalize = (photoData) => {
        confirmMurder(
          game.code,
          murder.id,
          playerName,
          murdererSelect.value,
          typeof photoData === "string" ? photoData : murder.photoData || ""
        );
      };
      if (file) {
        button.disabled = true;
        const reader = new FileReader();
        reader.onload = (event) => {
          button.disabled = false;
          finalize(event.target?.result || "");
        };
        reader.onerror = () => {
          button.disabled = false;
          alert("We couldn't read that file. Please try again.");
        };
        reader.readAsDataURL(file);
      } else {
        finalize(murder.photoData || "");
      }
    });
    actions.appendChild(button);
    fragment.appendChild(node);
  });
  playerSelectors.confirmations.appendChild(fragment);
}

function renderTimeline(game) {
  playerSelectors.timeline.innerHTML = "";
  const confirmed = game.murders
    .filter((murder) => murder.confirmed)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (!confirmed.length) {
    playerSelectors.timeline.textContent = "No confirmed murders yet.";
    return;
  }
  const fragment = document.createDocumentFragment();
  confirmed.forEach((murder) => {
    const node = playerMurderTemplate.content.cloneNode(true);
    node.querySelector(".murder-card__title").textContent = `${murder.murderer} eliminated ${murder.victim}`;
    node.querySelector(".murder-card__timestamp").textContent = formatDateTime(
      murder.confirmedAt || murder.timestamp
    );
    node.querySelector(".murder-card__notes").textContent = murder.notes || "No notes provided.";
    const image = node.querySelector(".murder-card__image");
    if (murder.photoData) {
      image.src = murder.photoData;
      image.classList.remove("hidden");
    } else {
      image.classList.add("hidden");
    }
    node.querySelector(".murder-card__actions").textContent = `Confirmed by ${
      murder.confirmedBy || murder.victim
    }`;
    fragment.appendChild(node);
  });
  playerSelectors.timeline.appendChild(fragment);
}

function renderVoteOptions(game, selfName) {
  playerSelectors.voteSelect.innerHTML = "";
  playerSelectors.voteSelect.append(new Option("Select a suspect", ""));
  Object.values(game.players)
    .filter((player) => player.name !== selfName)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((player) => {
      playerSelectors.voteSelect.append(new Option(player.name, player.name));
    });
}

function renderVoteStatus(game, name) {
  const vote = game.votes[name];
  if (!vote || !vote.suspect) {
    playerSelectors.voteStatus.textContent = "You have not voted yet.";
  } else {
    playerSelectors.voteStatus.textContent = `You voted for ${vote.suspect} on ${formatDateTime(
      vote.timestamp
    )}.`;
    playerSelectors.voteSelect.value = vote.suspect;
  }
}

function renderPlayerResults(game) {
  playerSelectors.resultsSummary.innerHTML = "";
  if (!game.correctAnswer && !Object.keys(game.votes).length) {
    playerSelectors.resultsSummary.textContent = "Results will appear once the host finalizes the mystery.";
    return;
  }
  const fragment = buildResultsSummary(game);
  playerSelectors.resultsSummary.appendChild(fragment);
}

async function confirmMurder(gameCode, murderId, confirmedBy, murdererName, photoData) {
  const game = await updateGame(gameCode, (current) => {
    const murder = current.murders.find((entry) => entry.id === murderId);
    if (murder) {
      if (murdererName) {
        murder.murderer = murdererName;
      }
      if (typeof photoData === "string") {
        murder.photoData = photoData;
      }
      murder.confirmed = true;
      murder.confirmedBy = confirmedBy;
      murder.confirmedAt = Date.now();
    }
    return current;
  });
  if (!game) return;
  if (state.playerSession && state.playerSession.gameCode === gameCode) {
    syncPlayerDashboard(game);
  }
}

async function handleMurderSubmission(event) {
  event.preventDefault();
  if (!state.playerSession) return;
  const { gameCode, name } = state.playerSession;
  const notes = playerSelectors.murderNotes.value.trim();
  const target = playerSelectors.murderTarget.value;
  if (!target || target === "Target not assigned") {
    alert("You don't have a target yet.");
    return;
  }
  const timestamp = Date.now();
  try {
    const game = await updateGame(gameCode, (current) => {
      current.murders.push({
        id: `${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
        murderer: name,
        victim: target,
        notes,
        timestamp,
        photoData: "",
        confirmed: false,
      });
      return current;
    });
    if (game) {
      playerSelectors.murderForm.reset();
      playerSelectors.murderTarget.value = target;
      syncPlayerDashboard(game);
    }
  } catch (error) {
    console.error("Failed to submit murder", error);
  }
}

async function handleVoteSubmission(event) {
  event.preventDefault();
  if (!state.playerSession) return;
  const { gameCode, name } = state.playerSession;
  const suspect = playerSelectors.voteSelect.value;
  const game = await updateGame(gameCode, (current) => {
    current.votes[name] = {
      suspect,
      timestamp: Date.now(),
    };
    return current;
  });
  if (game) {
    renderVoteStatus(game, name);
    renderPlayerResults(game);
  }
}

// Admin Experience
let adminSelectors = null;
let adminPlayerTemplate = null;
let adminAssignmentTemplate = null;
let adminMurderTemplate = null;

async function initAdminView() {
  adminSelectors = {
    loginSection: document.getElementById("admin-login"),
    loginForm: document.getElementById("admin-login-form"),
    loginPassword: document.getElementById("admin-password"),
    loginError: document.getElementById("admin-login-error"),
    panel: document.getElementById("admin-panel"),
    logout: document.getElementById("admin-logout"),
    createGameForm: document.getElementById("create-game-form"),
    generateCode: document.getElementById("generate-code"),
    gameSelect: document.getElementById("admin-game-select"),
    gameManagement: document.getElementById("game-management"),
    managementTitle: document.getElementById("management-title"),
    managementCode: document.getElementById("management-code"),
    managementCreated: document.getElementById("management-created"),
    phaseSelect: document.getElementById("phase-select"),
    setPhase: document.getElementById("set-phase"),
    nextPhase: document.getElementById("next-phase"),
    registrationStatus: document.getElementById("registration-status"),
    toggleStarted: document.getElementById("toggle-started"),
    revealPins: document.getElementById("reset-pinboard"),
    pinboard: document.getElementById("pinboard"),
    adminAddPlayer: document.getElementById("admin-add-player"),
    adminPlayerName: document.getElementById("admin-player-name"),
    adminPlayerList: document.getElementById("admin-player-list"),
    assignRandom: document.getElementById("assign-random"),
    clearTargets: document.getElementById("clear-targets"),
    manualAssignments: document.getElementById("manual-assignments"),
    assignmentChain: document.getElementById("assignment-chain"),
    correctAnswerForm: document.getElementById("correct-answer-form"),
    correctAnswerSelect: document.getElementById("correct-answer"),
    resultsSummary: document.getElementById("results-summary"),
    adminMurders: document.getElementById("admin-murders"),
    adminVotes: document.getElementById("admin-votes"),
  };

  adminPlayerTemplate = document.getElementById("player-row-template");
  adminAssignmentTemplate = document.getElementById("manual-assignment-template");
  adminMurderTemplate = document.getElementById("murder-card-template");

  adminSelectors.loginForm?.addEventListener("submit", handleAdminLogin);
  adminSelectors.logout?.addEventListener("click", handleAdminLogout);
  adminSelectors.createGameForm?.addEventListener("submit", handleCreateGame);
  adminSelectors.generateCode?.addEventListener("click", handleGenerateCode);
  adminSelectors.gameSelect?.addEventListener("change", () => {
    handleAdminGameSelect();
  });
  adminSelectors.setPhase?.addEventListener("click", handleSetPhase);
  adminSelectors.nextPhase?.addEventListener("click", handleAdvancePhase);
  adminSelectors.toggleStarted?.addEventListener("click", handleToggleStarted);
  adminSelectors.revealPins?.addEventListener("click", handleTogglePinboard);
  adminSelectors.adminAddPlayer?.addEventListener("submit", handleAdminAddPlayer);
  adminSelectors.assignRandom?.addEventListener("click", handleAssignRandom);
  adminSelectors.clearTargets?.addEventListener("click", handleClearTargets);
  adminSelectors.correctAnswerForm?.addEventListener("submit", handleCorrectAnswerSave);
  adminSelectors.adminPlayerList?.addEventListener("click", handleAdminRemovePlayer);

  loadAdminSession();
  if (state.adminAuthorized) {
    await unlockAdminPanel();
  }
}

async function handleAdminLogin(event) {
  event.preventDefault();
  const password = adminSelectors.loginPassword.value.trim();
  if (password !== ADMIN_PASSWORD) {
    adminSelectors.loginError.textContent = "Incorrect password. Try again.";
    adminSelectors.loginPassword.focus();
    return;
  }
  adminSelectors.loginPassword.value = "";
  adminSelectors.loginError.textContent = "";
  state.revealPins = false;
  saveAdminSession(true);
  await unlockAdminPanel();
}

async function unlockAdminPanel() {
  adminSelectors.loginSection.classList.add("hidden");
  adminSelectors.panel.classList.remove("hidden");
  await renderAdminGames();
  const firstGame = state.adminGameCode || adminSelectors.gameSelect.value;
  if (firstGame) {
    await handleAdminGameSelect();
  }
}

function handleAdminLogout() {
  saveAdminSession(false);
  state.adminGameCode = null;
  state.revealPins = false;
  adminSelectors.panel.classList.add("hidden");
  adminSelectors.loginSection.classList.remove("hidden");
}

async function renderAdminGames() {
  if (!adminSelectors) return;
  const games = await listGames();
  adminSelectors.gameSelect.innerHTML = "";
  adminSelectors.gameSelect.append(new Option("Select a game", ""));
  games.forEach((game) => {
    adminSelectors.gameSelect.append(new Option(game.name ? `${game.name} (${game.code})` : game.code, game.code));
  });
  if (state.adminGameCode && games.find((game) => game.code === state.adminGameCode)) {
    adminSelectors.gameSelect.value = state.adminGameCode;
  } else if (games.length) {
    adminSelectors.gameSelect.value = games[0].code;
    state.adminGameCode = games[0].code;
  } else {
    state.adminGameCode = null;
    if (adminSelectors.gameManagement) {
      adminSelectors.gameManagement.classList.add("hidden");
    }
  }
}

async function handleAdminGameSelect() {
  const code = adminSelectors.gameSelect.value;
  state.adminGameCode = code || null;
  if (!code) {
    adminSelectors.gameManagement.classList.add("hidden");
    return;
  }
  const game = await getGame(code);
  if (!game) {
    adminSelectors.gameManagement.classList.add("hidden");
    return;
  }
  renderGameManagement(game);
}

function renderGameManagement(game) {
  state.adminGameCode = game.code;
  adminSelectors.gameManagement.classList.remove("hidden");
  adminSelectors.managementTitle.textContent = game.name || "Untitled Mystery";
  adminSelectors.managementCode.textContent = game.code;
  adminSelectors.managementCreated.textContent = formatDateTime(game.createdAt);
  adminSelectors.registrationStatus.textContent = game.started ? "locked" : "open";
  adminSelectors.toggleStarted.textContent = game.started ? "Reopen registration" : "Lock registration";
  adminSelectors.revealPins.textContent = state.revealPins ? "Hide Player PINs" : "Reveal Player PINs";
  adminSelectors.phaseSelect.innerHTML = "";
  PHASES.forEach((phase) => {
    const option = new Option(phaseLabel(phase), phase);
    option.selected = phase === game.phase;
    adminSelectors.phaseSelect.append(option);
  });
  adminSelectors.correctAnswerSelect.innerHTML = "";
  adminSelectors.correctAnswerSelect.append(new Option("Select culprit", ""));
  Object.values(game.players)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((player) => {
      adminSelectors.correctAnswerSelect.append(new Option(player.name, player.name));
    });
  adminSelectors.correctAnswerSelect.value = game.correctAnswer || "";

  renderPinboard(game);
  renderAdminPlayerList(game);
  renderManualAssignments(game);
  renderAssignmentChain(game);
  renderAdminMurders(game);
  renderAdminVotes(game);
  renderAdminResults(game);
}

function renderPinboard(game) {
  adminSelectors.pinboard.innerHTML = "";
  if (!state.revealPins) {
    adminSelectors.pinboard.textContent = "Pins hidden. Click \"Reveal Player PINs\" to show them temporarily.";
    return;
  }
  const fragment = document.createDocumentFragment();
  Object.values(game.players)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((player) => {
      const entry = document.createElement("div");
      entry.textContent = `${player.name} — PIN: ${player.pin}`;
      fragment.appendChild(entry);
    });
  if (!fragment.childNodes.length) {
    adminSelectors.pinboard.textContent = "No players yet.";
    return;
  }
  adminSelectors.pinboard.appendChild(fragment);
}

async function handleTogglePinboard() {
  state.revealPins = !state.revealPins;
  adminSelectors.revealPins.textContent = state.revealPins ? "Hide Player PINs" : "Reveal Player PINs";
  if (state.adminGameCode) {
    const game = await getGame(state.adminGameCode);
    if (game) {
      renderPinboard(game);
    }
  }
}

function renderAdminPlayerList(game) {
  adminSelectors.adminPlayerList.innerHTML = "";
  const players = Object.values(game.players);
  if (!players.length) {
    adminSelectors.adminPlayerList.textContent = "No players added yet.";
    return;
  }
  const fragment = document.createDocumentFragment();
  players
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((player) => {
      const node = adminPlayerTemplate.content.cloneNode(true);
      node.querySelector(".player-name").textContent = player.name;
      node.querySelector(".player-pin").textContent = state.revealPins ? `PIN: ${player.pin}` : "PIN hidden";
      node.querySelector(".player-target").textContent = player.target ? `Targets ${player.target}` : "No target";
      const remove = node.querySelector(".remove-player");
      remove.dataset.playerName = player.name;
      fragment.appendChild(node);
    });
  adminSelectors.adminPlayerList.appendChild(fragment);
}

function renderManualAssignments(game) {
  adminSelectors.manualAssignments.innerHTML = "";
  const players = Object.values(game.players);
  if (players.length < 2) {
    adminSelectors.manualAssignments.textContent = "Add at least two players to assign targets.";
    return;
  }
  const fragment = document.createDocumentFragment();
  players
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((player) => {
      const node = adminAssignmentTemplate.content.cloneNode(true);
      const label = node.querySelector("label");
      label.textContent = player.name;
      const select = node.querySelector("select");
      select.dataset.playerName = player.name;
      select.append(new Option("No target", ""));
      players
        .filter((candidate) => candidate.name !== player.name)
        .forEach((candidate) => {
          select.append(new Option(candidate.name, candidate.name));
        });
      select.value = player.target || "";
      select.addEventListener("change", handleManualAssignmentChange);
      fragment.appendChild(node);
    });
  adminSelectors.manualAssignments.appendChild(fragment);
}

async function handleManualAssignmentChange(event) {
  const select = event.target;
  const name = select.dataset.playerName;
  if (!name || !state.adminGameCode) return;
  const value = select.value;
  const game = await updateGame(state.adminGameCode, (current) => {
    if (current.players[name]) {
      current.players[name].target = value;
    }
    return current;
  });
  if (game) {
    renderAssignmentChain(game);
  }
}

function renderAssignmentChain(game) {
  adminSelectors.assignmentChain.innerHTML = "";
  const players = Object.values(game.players).filter((player) => player.target);
  if (!players.length) {
    adminSelectors.assignmentChain.textContent = "No targets assigned.";
    return;
  }
  const list = document.createElement("ol");
  list.className = "results-list";
  players
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((player) => {
      const item = document.createElement("li");
      item.innerHTML = `<strong>${player.name}</strong> ➜ ${player.target}`;
      list.appendChild(item);
    });
  adminSelectors.assignmentChain.appendChild(list);
}

function renderAdminMurders(game) {
  adminSelectors.adminMurders.innerHTML = "";
  if (!game.murders.length) {
    adminSelectors.adminMurders.textContent = "No murders submitted yet.";
    return;
  }
  const fragment = document.createDocumentFragment();
  const pending = game.murders.filter((murder) => !murder.confirmed);
  const confirmed = game.murders
    .filter((murder) => murder.confirmed)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (pending.length) {
    const header = document.createElement("h4");
    header.textContent = "Pending confirmation";
    fragment.appendChild(header);
    pending.forEach((murder) => {
      fragment.appendChild(buildMurderCard(murder, "Awaiting victim confirmation"));
    });
  }

  if (confirmed.length) {
    const header = document.createElement("h4");
    header.textContent = "Confirmed";
    fragment.appendChild(header);
    confirmed.forEach((murder) => {
      fragment.appendChild(
        buildMurderCard(murder, `Confirmed by ${murder.confirmedBy || murder.victim}`)
      );
    });
  }
  adminSelectors.adminMurders.appendChild(fragment);
}

function buildMurderCard(murder, footerText) {
  const node = adminMurderTemplate.content.cloneNode(true);
  node.querySelector(".murder-card__title").textContent = `${murder.murderer} → ${murder.victim}`;
  node.querySelector(".murder-card__timestamp").textContent = formatDateTime(murder.timestamp);
  node.querySelector(".murder-card__notes").textContent = murder.notes || "No notes provided.";
  const image = node.querySelector(".murder-card__image");
  if (murder.photoData) {
    image.src = murder.photoData;
    image.classList.remove("hidden");
  } else {
    image.classList.add("hidden");
  }
  node.querySelector(".murder-card__actions").textContent = footerText;
  return node;
}

function renderAdminVotes(game) {
  adminSelectors.adminVotes.innerHTML = "";
  const votes = Object.entries(game.votes);
  if (!votes.length) {
    adminSelectors.adminVotes.textContent = "No votes submitted yet.";
    return;
  }
  const list = document.createElement("ul");
  list.className = "results-list";
  votes
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([player, vote]) => {
      const item = document.createElement("li");
      item.innerHTML = `<strong>${player}</strong> voted for ${vote.suspect || "Undecided"}`;
      list.appendChild(item);
    });
  adminSelectors.adminVotes.appendChild(list);
}

function renderAdminResults(game) {
  adminSelectors.resultsSummary.innerHTML = "";
  const fragment = buildResultsSummary(game);
  adminSelectors.resultsSummary.appendChild(fragment);
}

function buildResultsSummary(game) {
  const fragment = document.createDocumentFragment();
  const votes = Object.entries(game.votes);
  if (!votes.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No votes recorded yet.";
    fragment.appendChild(empty);
  } else {
    const list = document.createElement("ul");
    list.className = "results-list";
    votes
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([player, vote]) => {
        const item = document.createElement("li");
        item.innerHTML = `<strong>${player}</strong> → ${vote.suspect || "Undecided"}`;
        list.appendChild(item);
      });
    fragment.appendChild(list);
  }
  if (game.correctAnswer) {
    const winners = votes
      .filter(([, vote]) => vote.suspect === game.correctAnswer)
      .map(([name]) => name);
    const highlight = document.createElement("div");
    highlight.className = "results-highlight";
    highlight.innerHTML = `
      <p><strong>Correct culprit:</strong> ${game.correctAnswer}</p>
      <p><strong>Winners:</strong> ${winners.length ? winners.join(", ") : "No one guessed correctly"}</p>
    `;
    fragment.appendChild(highlight);
  }
  return fragment;
}

async function handleCreateGame(event) {
  event.preventDefault();
  const formData = new FormData(adminSelectors.createGameForm);
  let code = (formData.get("gameCode") || "").trim().toUpperCase();
  const name = (formData.get("gameName") || "").trim();
  if (!code) {
    code = randomCode();
  }
  if (!/^[A-Z0-9]{3,6}$/.test(code)) {
    alert("Game code should be 3-6 letters or numbers.");
    return;
  }
  try {
    await ensureGame(code);
    if (name) {
      await updateGame(code, (current) => {
        current.name = name;
        return current;
      });
    }
  } catch (error) {
    console.error("Unable to create or update game", error);
    alert("Failed to create the game. Please try again.");
    return;
  }
  adminSelectors.createGameForm.reset();
  await renderAdminGames();
  adminSelectors.gameSelect.value = code;
  await handleAdminGameSelect();
}

function handleGenerateCode() {
  adminSelectors.createGameForm.gameCode.value = randomCode();
}

async function handleSetPhase(event) {
  event.preventDefault();
  if (!state.adminGameCode) return;
  const phase = adminSelectors.phaseSelect.value;
  const game = await updateGame(state.adminGameCode, (current) => {
    current.phase = phase;
    return current;
  });
  if (game) {
    renderGameManagement(game);
  }
}

async function handleAdvancePhase(event) {
  event.preventDefault();
  if (!state.adminGameCode) return;
  const game = await updateGame(state.adminGameCode, (current) => {
    current.phase = nextPhase(current.phase);
    return current;
  });
  if (game) {
    renderGameManagement(game);
  }
}

async function handleToggleStarted(event) {
  event.preventDefault();
  if (!state.adminGameCode) return;
  const game = await updateGame(state.adminGameCode, (current) => {
    current.started = !current.started;
    if (!current.started) {
      current.phase = "murders";
    }
    return current;
  });
  if (game) {
    renderGameManagement(game);
  }
}

async function handleAdminAddPlayer(event) {
  event.preventDefault();
  if (!state.adminGameCode) return;
  const name = adminSelectors.adminPlayerName.value.trim();
  if (!name) return;
  try {
    const game = await updateGame(state.adminGameCode, (current) => {
      if (current.players[name]) {
        throw new Error("Player exists");
      }
      current.players[name] = {
        name,
        pin: randomPin(),
        target: "",
      };
      return current;
    });
    adminSelectors.adminPlayerName.value = "";
    if (game) {
      renderGameManagement(game);
    }
  } catch (error) {
    alert("A player with that name already exists.");
  }
}

async function handleAdminRemovePlayer(event) {
  const button = event.target.closest(".remove-player");
  if (!button || !state.adminGameCode) return;
  const name = button.dataset.playerName;
  if (!name) return;
  if (!confirm(`Remove ${name} from the game?`)) return;
  const game = await updateGame(state.adminGameCode, (current) => {
    delete current.players[name];
    current.murders = current.murders.filter(
      (murder) => murder.murderer !== name && murder.victim !== name
    );
    delete current.votes[name];
    Object.values(current.votes).forEach((vote) => {
      if (vote.suspect === name) {
        vote.suspect = "";
      }
    });
    Object.values(current.players).forEach((player) => {
      if (player.target === name) {
        player.target = "";
      }
    });
    if (current.correctAnswer === name) {
      current.correctAnswer = "";
    }
    return current;
  });
  if (game) {
    renderGameManagement(game);
  }
}

async function handleAssignRandom(event) {
  event.preventDefault();
  if (!state.adminGameCode) return;
  const game = await updateGame(state.adminGameCode, (current) => {
    const players = Object.values(current.players);
    if (players.length < 2) {
      alert("Add at least two players before assigning targets.");
      return current;
    }
    const shuffled = [...players];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    shuffled.forEach((player, index) => {
      const target = shuffled[(index + 1) % shuffled.length];
      current.players[player.name].target = target.name;
    });
    return current;
  });
  if (game) {
    renderGameManagement(game);
  }
}

async function handleClearTargets(event) {
  event.preventDefault();
  if (!state.adminGameCode) return;
  const game = await updateGame(state.adminGameCode, (current) => {
    Object.values(current.players).forEach((player) => {
      player.target = "";
    });
    return current;
  });
  if (game) {
    renderGameManagement(game);
  }
}

async function handleCorrectAnswerSave(event) {
  event.preventDefault();
  if (!state.adminGameCode) return;
  const value = adminSelectors.correctAnswerSelect.value;
  const game = await updateGame(state.adminGameCode, (current) => {
    current.correctAnswer = value;
    return current;
  });
  if (game) {
    renderAdminResults(game);
  }
}

// Initialization
async function bootstrap() {
  initCommon();
  try {
    await refreshGamesFromServer();
  } catch (error) {
    console.warn("Starting with empty data due to load error", error);
  }
  if (document.body.dataset.view === "player") {
    await initPlayerView();
  }
  if (document.body.dataset.view === "admin") {
    await initAdminView();
  }
  allowSync = true;
  if (pendingSync) {
    pendingSync = false;
    scheduleSync();
  } else {
    scheduleSync();
  }
  initRealtimeUpdates();
}

bootstrap();
