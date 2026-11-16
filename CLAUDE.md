# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

*Journey to Hedgeheart*: a Phaser 3 endless-runner (in the style of Chrome's dinosaur game) in which a hedgehog dodges obstacles while a countdown to a fixed date (`dateOfMeetingInSeconds`) ticks towards zero. It is a static site served by GitHub Pages at journeytohedgeheart.com (`CNAME`). There is no build step, bundler, linter or test suite.

## Running it

Serve the repository root over HTTP and open the page in a browser; opening the file directly from disk breaks asset loading:

```
python3 -m http.server 8000
# http://localhost:8000/index.html     (live Season 1 game)
# http://localhost:8000/index_s2.html  (Season 2, in development)
# http://localhost:8000/3d/            (3D version, in development)
```

Phaser is vendored at `assets/phaser-arcade-physics.min.js` and loaded by a `<script>` tag. The `phaser` entry in `package.json` is unused by the pages. The 3D version uses three.js r160 instead, vendored at `assets/three.module.min.js` and imported as an ES module.

## Versioned game files

Each `platformer*.js` is a complete, standalone snapshot of the game, not a module. Three are wired to pages:

- `index.html` → `platformer_v3.1.js` (production, Season 1)
- `index_s2.html` → `platformer_v4.js` (Season 2: unicorn, high score, rainbow, sunglasses costume, day/night cycle)
- `3d/index.html` → `platformer_v5.js` (3D: the hedgehog runs straight ahead down three lanes). The page sets `<base href="../">`, so it shares the root's script, styles and `assets/`.

`platformer.js`, `platformer_v2.js`, `platformer_v3.js` and `earlyTests.html` are historical. Make new work in `platformer_v4.js` unless told otherwise; a fix meant for the live site must go into `platformer_v3.1.js`. The Season 2 roadmap sits in the comment block at the top of `platformer_v4.js`.

## Game architecture (platformer_v4.js)

- A single Phaser scene built from the global functions `preload`/`create`/`update`. All state lives in top-level `let` globals (`gameState` is `'before' | 'during' | 'after'`, plus `score`, `platformSpeed`, `obstaclesArray`, `inputState`), and the tuning constants sit at the top of the file.
- **Score is time.** `score` is the number of seconds remaining until the meeting date. `countGameTime` (a one-second timer) subtracts 1, and passing an obstacle subtracts that obstacle's `score`. Under 10 seconds, the `cyanHeart` winner obstacle spawns.
- **Difficulty** rises every `gameSpeedUpInterval` seconds by `gameSpeedUpFactor` added to `platformSpeed`. That also unlocks more of the `obstacles` list in `addObstacle` (`platformSpeed * 3` entries) and shortens spawn gaps.
- **Obstacles** are defined as data objects in `addObstacle` (`speedFactor`, `startingHeight`, `gravity`, `width`, `tween`, `depth`, `score`) and drawn by `renderObstacle`, which switches on the `tween` name for animation. To add an obstacle: load its image in `preload`, add an entry to the list, and add a tween case if needed.
- **Input** from the keyboard, the on-screen mobile buttons (`#left-btn`, `#jump-btn`, `#right-btn` in the HTML) and the AI socket all write to the shared `inputState`, which `update` reads.
- The high score persists in `localStorage` under `j2hh_highscore`.

## 3D version (platformer_v5.js)

A port of v4 to three.js, loaded with `<script type="module">`. It keeps v4's conventions (top-level `let` state, `preload`/`create`/`update`, obstacle data objects in `addObstacle`, `renderObstacle` plus a `tween` switch in `animateObstacle`, shared `inputState`) but differs as follows:

- The hedgehog stays at `z = 0` in one of three `lanes`; the world slides towards the camera at `worldSpeed()`. Obstacles spawn at `-spawnDistance` and close at `approachSpeed(obs)`.
- The hedgehog is a 3D model built from primitives in `createHedgehog` (hinged legs, a coat of instanced spines, hidden sunglasses); `updatePlayer` swings the legs and turns the body into lane changes. The other characters are the original PNGs on upright planes (`makeCard`) with blob shadows. Scenery is low-poly meshes. There is no physics engine: `collides` does a box test, and timers are counters in `timers`.
- Obstacles carry `jumpable`; `fairLane` stops unjumpable ones closing all three lanes at once. Birds fly at jump height, so staying grounded passes under them.
- `inputState.left`/`right` are one-shot lane changes consumed by `updatePlayer`.
- The HUD (scoreboard tiles for days/hrs/min/sec, message, button) is HTML inside `#game-container`, styled in `3d/index.html`. Passing an obstacle spawns a 3D score chip (`makeChip`) in the scene; `timeCells` formats both the scoreboard and the chips.
- If `dateOfMeetingInSeconds` has passed, a run counts down from `fallbackJourneySeconds`. The high score lives under `j2hh_highscore_3d`.
- `window.j2hh` exposes state, `setScore` and `setSpeed` for debugging and headless play-testing.
- The AI grid is a bird's-eye view: first index across the lanes, second from horizon (0) to hedgehog (9).

## AI training harness (Python)

The game can be driven by a reinforcement-learning agent over WebSocket. Set `AIControl = true` in the JS. The game then connects as a client to `ws://localhost:8081`, receives `{"action": ...}` messages (`0` left, `1` right, `2` jump, `3` idle, or `"Start"`/`"Reset"`), and replies with `gameStatusResponse()`: `{state: 10x10 grid, reward, done}`. The grid marks the player as 1 and unpassed obstacles as `floor(speedFactor)+1`.

Python servers (each listens on port 8081; run one at a time, then load the page):

- `learningAgent.py`: DQN agent (TensorFlow/Keras) that trains and saves to `saved_model/j2hh_learning_model.keras` (gitignored).
- `evaluate_model.py`: loads the saved model, plays, and plots results with matplotlib.
- `websocketServer.py`: a scripted action sequence for smoke-testing the socket link.

Dependencies (not pinned anywhere): `websockets`, `tensorflow`, `numpy`, `matplotlib`. The handlers use the older `(websocket, path)` signature, so recent `websockets` releases may need a version pin.
