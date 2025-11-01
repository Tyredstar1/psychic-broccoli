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
All information is stored in the browser's `localStorage`, so a single device can host the entire game offline. If you need a clean slate, clear the browser storage or open the page in a private window.

## 🚀 Getting started

1. Clone this repository.
2. Open `index.html` in your browser to use the app locally.
3. To deploy on GitHub Pages, push the repository to a public repo and enable Pages for the `main` branch (or the dedicated Pages branch).

## 🧩 Tips for party hosts
- Share the game code with players and distribute their PINs privately.
- Encourage players to confirm murders quickly so the investigation timeline stays up to date.
- When you're ready for the trial, remind players to vote from their dashboard, then reveal the results from the host panel.

## 📱 Responsive design
The interface is optimized for both mobile and desktop devices so players can participate from their phones during the party.
