**Murder Mystery Party Web App (GitHub Pages Hosted)**

Build a web application for hosting murder mystery party games with the following features:

**Core Functionality:**

1. **Game Setup & Player Management**
   - Create a new game session with a unique game code
   - Game host can add players by name and assign each player a secret target (who they're supposed to "kill")
   - Generate unique PIN codes for each player (4-6 digits) for privacy
   - Display the assignment chain so the host can verify everyone has a target

2. **Player Authentication**
   - Players log in using their name + PIN code
   - Each player can only see their own assigned target
   - Secure session management to keep assignments private

3. **Murder Documentation**
   - Players can upload photos of their "murders" with:
     - Timestamp of when it occurred
     - Optional notes/description of the murder method
     - Victim confirmation (the victim should be able to confirm they were eliminated)
   - Create a timeline/gallery view of all murders for investigation phase
   - Only show murders after they're confirmed

4. **Investigation Phase**
   - Display all confirmed murders in chronological order
   - Show photos and details for review
   - Players can view the evidence to prepare for the trial

5. **Voting & Resolution**
   - Trial phase where all players vote on who they think the "real killer" is (or whatever the mystery objective is)
   - Each player submits their vote privately
   - Host enters the correct answer
   - Results page showing:
     - All votes
     - Correct answer
     - Winner(s)
     - Complete murder chain visualization

**Technical Requirements:**
- **Must be deployable to GitHub Pages** (static site hosting)
- Pure frontend application - single HTML file with embedded JavaScript and CSS, OR a simple React app that builds to static files
- **Data persistence options:**
  - Use localStorage for same-device sessions, OR
  - Integrate a free serverless backend like Firebase (Firestore + Storage for images) or Supabase
  - If using a backend, keep it simple and free-tier friendly
- Image handling: Base64 encoding for localStorage, or cloud storage if using Firebase/Supabase
- Responsive design for mobile devices
- Clean, intuitive UI suitable for party atmosphere
- Include a README with setup and deployment instructions

**User Flow:**
1. Host creates game → adds players → assigns targets → distributes PINs
2. Players log in → see their target → commit murders → upload evidence
3. Investigation phase → everyone reviews the evidence
4. Trial → everyone votes → results revealed

Make the UI fun and thematic (mystery/detective aesthetic) but keep it simple and easy to use during an active party.

**Deployment:** Ensure the app works when deployed to GitHub Pages with proper configuration for client-side routing if needed.
