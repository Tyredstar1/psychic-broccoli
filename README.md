# Murder Mystery Party Web App

Host and play murder mystery party games from a single static web page that can be deployed to GitHub Pages. The experience is split into a host control center and a player portal so everyone can manage the party from their own device.

## ✨ Features

### Game setup & player management
- Create or load games by entering a short game code (auto-generated codes available).
- Add players with unique PINs generated automatically.
- Randomly assign secret targets in a closed loop so no one targets themselves.
- View the assignment chain to validate target distribution.

### Player authentication & dashboard
- Players log in with game code, name, and PIN.
- Dashboard shows each player's secret target and provides controls for the rest of the game phases.

### Murder documentation
- Players record murders by adding notes and optional photo evidence (stored locally via Base64).
- Murders remain private until confirmed by the victim.

### Investigation phase
- Confirmed murders appear in a chronological timeline that everyone can review before the trial.

### Voting & resolution
- Players submit private votes from their dashboards.
- The host sets the official culprit and sees a vote breakdown plus the list of winners.

## 🗂 Data storage
Game state now lives on a lightweight Node.js server so every browser connected to the same host shares the same information. Data is persisted to `data/games.json` so you can stop and restart the server without losing progress. Delete that file if you need to reset everything.

## 🚀 Getting started

1. Clone this repository.
2. From the project root run `node server.js` (Node.js 18+ recommended).
3. Open [http://localhost:3000/](http://localhost:3000/) for the player portal and [http://localhost:3000/admin/](http://localhost:3000/admin/) for the host dashboard.
4. Share the server address with everyone playing. Each browser session will stay in sync automatically via Server-Sent Events.

## 🧩 Tips for party hosts
- Share the game code with players and distribute their PINs privately.
- Encourage players to confirm murders quickly so the investigation timeline stays up to date.
- When you're ready for the trial, remind players to vote from their dashboard, then reveal the results from the host panel.

## 🧑‍🤝‍🧑 Real-time collaboration
Updates made from either the host dashboard or a player device stream to every connected browser instantly. If the live stream is unavailable (for example, in an older browser), the client will automatically fall back to periodic polling so no one is left behind.

## 📱 Responsive design
The interface is optimized for both mobile and desktop devices so players can participate from their phones during the party.
