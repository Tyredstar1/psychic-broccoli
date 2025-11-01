import { createServer } from "http";
import { readFileSync, writeFileSync, mkdirSync, statSync, createReadStream } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "games.json");
const PHASES = ["murders", "investigation", "voting", "results"];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const clients = new Set();

function randomPin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function loadGamesFromDisk() {
  try {
    const raw = readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (error) {
    console.warn("Starting with empty game list", error.message);
  }
  return {};
}

let games = loadGamesFromDisk();

function persistGames() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(games, null, 2));
}

function normalizeGame(raw = {}, codeOverride) {
  const code = (codeOverride || raw.code || "").toUpperCase();
  const base = {
    code,
    name: raw.name || "",
    players: raw.players && typeof raw.players === "object" ? { ...raw.players } : {},
    murders: Array.isArray(raw.murders) ? [...raw.murders] : [],
    votes: raw.votes && typeof raw.votes === "object" ? { ...raw.votes } : {},
    correctAnswer: raw.correctAnswer || "",
    started: Boolean(raw.started),
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

  base.murders = base.murders.map((entry) => ({
    id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    murderer: entry.murderer || "",
    victim: entry.victim || "",
    notes: entry.notes || "",
    timestamp: entry.timestamp || Date.now(),
    photoData: entry.photoData || "",
    confirmed: Boolean(entry.confirmed),
    confirmedBy: entry.confirmedBy || "",
    confirmedAt: entry.confirmedAt || null,
  }));

  Object.entries(base.votes).forEach(([name, vote]) => {
    base.votes[name] = {
      suspect: vote.suspect || "",
      timestamp: vote.timestamp || Date.now(),
    };
  });

  return base;
}

function broadcast() {
  const payload = JSON.stringify({ type: "sync", games: Object.values(games) });
  clients.forEach((res) => {
    res.write(`data: ${payload}\n\n`);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/games") {
    sendJson(res, 200, { games: Object.values(games) });
    return true;
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/games/")) {
    const code = url.pathname.split("/").pop().toUpperCase();
    const game = games[code];
    if (!game) {
      sendJson(res, 404, { error: "Game not found" });
    } else {
      sendJson(res, 200, { game });
    }
    return true;
  }
  if (req.method === "PUT" && url.pathname.startsWith("/api/games/")) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const code = url.pathname.split("/").pop().toUpperCase();
        const createdAt = parsed.createdAt || games[code]?.createdAt || Date.now();
        const normalized = normalizeGame({ ...parsed, createdAt }, code);
        games[code] = normalized;
        persistGames();
        sendJson(res, 200, { game: normalized });
        broadcast();
      } catch (error) {
        console.error("Failed to save game", error);
        sendJson(res, 400, { error: "Invalid request" });
      }
    });
    req.on("error", (error) => {
      console.error("Request error", error);
    });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "sync", games: Object.values(games) })}\n\n`);
    clients.add(res);
    req.on("close", () => {
      clients.delete(res);
    });
    return true;
  }
  return false;
}

function safeJoin(base, target) {
  const resolved = path.normalize(path.join(base, target));
  if (!resolved.startsWith(base)) {
    return null;
  }
  return resolved;
}

function serveStatic(req, res, url) {
  if (url.pathname.startsWith("/data")) {
    res.writeHead(404);
    res.end();
    return;
  }
  let pathname = url.pathname;
  if (pathname === "/" || pathname === "") {
    pathname = "/index.html";
  }
  if (pathname.endsWith("/")) {
    pathname = path.join(pathname, "index.html");
  }
  const filePath = safeJoin(__dirname, pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const stats = statSync(filePath);
    if (stats.isDirectory()) {
      res.writeHead(403);
      res.end();
      return;
    }
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    const stream = createReadStream(filePath);
    stream.pipe(res);
    stream.on("error", () => {
      res.writeHead(500);
      res.end();
    });
  } catch (error) {
    res.writeHead(404);
    res.end();
  }
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = handleApi(req, res, url);
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    console.error("Unhandled server error", error);
    res.writeHead(500);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Murder Mystery server running on http://localhost:${PORT}`);
});
