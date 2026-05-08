# CPU Simulation Implementation Plan

## Goal

CPU-only matches should run without the browser so balance tuning can be based on repeatable match logs and aggregate summaries.

## Scope

1. Add a headless CPU simulation entry point.
2. Make deck shuffling reproducible with a seed.
3. Export machine-readable match logs.
4. Export an annotated human-readable integrated text report.
5. Keep the existing browser and online play behavior working.
6. Provide a browser GUI for running CPU simulations and reviewing generated logs.

## Implementation Steps

## Current Status

- Steps 1 to 5 are implemented.
- The text report now uses item-level log notes instead of repeating an annotation under every log line.
- The first CPU quality pass is implemented: setup, free development, discard, market exchange, and effect choices now record CPU decision metadata.
- CPU profiles are implemented and can be selected from the simulator.
- Card/effect aggregate analysis is implemented as a separate script.
- The simulation GUI is implemented at `simulation.html`.
- Generated simulation and analysis logs now include timestamped filenames and metadata.
- Remaining tuning work is to run larger samples and adjust profile/card weights from the analysis output.

### 1. Reproducible Randomness

- Add a small seeded RNG helper.
- Pass the RNG into deck creation and discard reshuffling.
- Keep `Math.random` as the default for normal browser play.

### 2. Synchronous Game Flow for Simulation

- Remove Promise-based dynamic imports from `GameState` turn progression.
- Use static imports for data and logger dependencies.
- This lets a simulation loop call `CPU.takeAction()` until `game.isGameOver`.

### 3. Headless Runner

- Add `scripts/simulate-cpu.mjs`.
- Support CLI options:
  - `--games <n>`
  - `--players <2-5>`
  - `--seed <value>`
  - `--out <path>`
  - `--summary <path>`
  - `--report <path>`
  - `--max-steps <n>`
  - `--profiles <id[,id...]|mixed>`
- Write JSONL logs for each game and a compact JSON summary.
- Write an integrated text report with item-level log notes.
- Default output names include a timestamp when explicit output paths are not provided.
- Simulation outputs are written under `logs/simulations`.

### 4. Annotated Report

- Create a text report after each simulation run.
- Include:
  - run summary
  - log item notes
  - aggregate score, demand, and role counts
  - aggregate CPU decision counts
  - aggregate score and CPU decision counts by profile
  - per-game final standings
  - integrated per-game logs
  - CPU decision metadata where available

### 5. npm Scripts

- Add `npm run simulate`.
- Add `npm run analyze`.
- Keep `npm start` unchanged.

### 6. CPU Quality Improvements

- Replace fixed initial setup choices with scored specialty selection. Done.
- Replace fixed free development choices with scored specialty selection. Done.
- Replace fixed discard choices with resource value scoring. Done.
- Add CPU decision metadata for major actions. Done.
- Replace discounted exchange first-choice behavior with scored selection. Done.
- Add CPU profiles for different strategies. Done.
- Add aggregate analysis scripts for card/effect win rates. Done.

### 7. CPU Profiles

- `balanced`: Existing default-style behavior.
- `demand`: Prioritizes demand completion and demand-progressing exchanges.
- `role`: Prioritizes fixed roles before spending cards on demand.
- `engine`: Prioritizes processing plants and effect value.
- `trader`: Prioritizes market exchanges.
- `mixed`: Simulator shortcut that assigns the listed profiles by seat in order.

### 8. Analysis Script

- Add `scripts/analyze-cpu-logs.mjs`.
- Support CLI options:
  - `--in <path[,path...]>`
  - `--summary <path>`
  - `--report <path>`
- Read CPU simulation JSONL output and calculate:
  - profile win rate and average score
  - demand category/card win rate and average score
  - demand effect win rate and average score
  - fixed role win rate and average score
  - processing plant and active specialty result trends
  - CPU decision counts by profile
- Analysis outputs are written under `logs/analysis`.

### 9. Simulation GUI

- Add `simulation.html`, `simulation.css`, and `src/simulation-gui.js`.
- Add server endpoints under `/api/simulation/*`:
  - `GET /api/simulation/profiles`
  - `GET /api/simulation/logs`
  - `POST /api/simulation/run`
  - `POST /api/simulation/analyze`
- The GUI can:
  - run CPU simulations with selected game count, player count, seed, max steps, and profiles
  - optionally run analysis immediately after simulation
  - list generated log files
  - run analysis again from selected JSONL logs
- Timestamp policy:
  - generated filenames use `YYYYMMDD-HHMMSS`
  - summary/report metadata includes `generatedAt` and `timestamp`
  - individual JSONL log entries include ISO `timestamp` and local `time`
- Folder policy:
  - `logs/simulations`: raw simulation JSONL, simulation summaries, simulation text reports
  - `logs/analysis`: analysis summaries and analysis text reports
