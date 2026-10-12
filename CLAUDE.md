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
```

Phaser is vendored at `assets/phaser-arcade-physics.min.js` and loaded by a `<script>` tag. The `phaser` entry in `package.json` is unused by the pages.

## Versioned game files

Each `platformer*.js` is a complete, standalone snapshot of the game, not a module. Only two are live:

- `index.html` → `platformer_v3.1.js` (production, Season 1)
- `index_s2.html` → `platformer_v4.js` (Season 2: unicorn, high score, rainbow, sunglasses costume, day/night cycle)

`platformer.js`, `platformer_v2.js`, `platformer_v3.js` and `earlyTests.html` are historical. Make new work in `platformer_v4.js` unless told otherwise; a fix meant for the live site must go into `platformer_v3.1.js`. The Season 2 roadmap sits in the comment block at the top of `platformer_v4.js`.

## Game architecture (platformer_v4.js)

- A single Phaser scene built from the global functions `preload`/`create`/`update`. All state lives in top-level `let` globals (`gameState` is `'before' | 'during' | 'after'`, plus `score`, `platformSpeed`, `obstaclesArray`, `inputState`), and the tuning constants sit at the top of the file.
- **Score is time.** `score` is the number of seconds remaining until the meeting date. `countGameTime` (a one-second timer) subtracts 1, and passing an obstacle subtracts that obstacle's `score`. Under 10 seconds, the `cyanHeart` winner obstacle spawns.
- **Difficulty** rises every `gameSpeedUpInterval` seconds by `gameSpeedUpFactor` added to `platformSpeed`. That also unlocks more of the `obstacles` list in `addObstacle` (`platformSpeed * 3` entries) and shortens spawn gaps.
- **Obstacles** are defined as data objects in `addObstacle` (`speedFactor`, `startingHeight`, `gravity`, `width`, `tween`, `depth`, `score`) and drawn by `renderObstacle`, which switches on the `tween` name for animation. To add an obstacle: load its image in `preload`, add an entry to the list, and add a tween case if needed.
- **Input** from the keyboard, the on-screen mobile buttons (`#left-btn`, `#jump-btn`, `#right-btn` in the HTML) and the AI socket all write to the shared `inputState`, which `update` reads.
- The high score persists in `localStorage` under `j2hh_highscore`.

## AI training harness (Python)

The game can be driven by a reinforcement-learning agent over WebSocket. Set `AIControl = true` in the JS. The game then connects as a client to `ws://localhost:8081`, receives `{"action": ...}` messages (`0` left, `1` right, `2` jump, `3` idle, or `"Start"`/`"Reset"`), and replies with `gameStatusResponse()`: `{state: 10x10 grid, reward, done}`. The grid marks the player as 1 and unpassed obstacles as `floor(speedFactor)+1`.

Python servers (each listens on port 8081; run one at a time, then load the page):

- `learningAgent.py`: DQN agent (TensorFlow/Keras) that trains and saves to `saved_model/j2hh_learning_model.keras` (gitignored).
- `evaluate_model.py`: loads the saved model, plays, and plots results with matplotlib.
- `websocketServer.py`: a scripted action sequence for smoke-testing the socket link.

Dependencies (not pinned anywhere): `websockets`, `tensorflow`, `numpy`, `matplotlib`. The handlers use the older `(websocket, path)` signature, so recent `websockets` releases may need a version pin.
