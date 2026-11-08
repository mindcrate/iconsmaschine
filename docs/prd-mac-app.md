# PRD: iconmaschine as a Mac app

Status: draft, waiting for Tim's approval.

## Problem statement

Today iconmaschine runs only from a terminal. Tim opens the project folder, runs `npm run dev` and
opens `http://localhost:4321` in a browser. Each Mac that runs it needs Node 22, a copy of the
code, `npm install` and a `.env.local` file with the API keys.

Tim wants to use the app on his other Mac. That Mac has none of this set up. He does not want to
start a server by hand each time he uses the app, on either Mac.

## What was checked before this PRD

These facts come from a test build made on 2026-11-08, not from documents:

- Electron 45.2.3 ships Node 24.22.2. Inside it, `node:sqlite` opened a database (SQLite 3.53.4)
  and `sharp` 0.35.5 made a PNG. These are the two parts that could have ruled Electron out.
- With `output: "standalone"`, `next build` made a 52 MB server folder. That server ran under
  Electron's Node. The page, `/api/status`, `/api/packs` and `/api/tagvocab` (which reads
  Maschine's database) all answered correctly.
- The build did not contain `.env.local` or the OpenAI key.
- The keys showed as loaded in the test only because Tim's shell already exports
  `OPENAI_API_KEY`. An app opened from Finder does not get shell variables, so the app needs its
  own place for keys.
- The Electron runtime alone is 259 MB on disk for Apple Silicon. The finished app will be about
  310 MB on disk, and the `.dmg` about 120 MB (an estimate).

## Goals

1. On either Mac, Tim opens iconmaschine from the Dock or Applications with one click. No
   terminal, no Node, no `npm`.
2. The packaged app does everything the dev version does: build, install to NI Resources, sample
   tags, preset tags, Calibrate, AI artwork and logo search.
3. Tim enters his API keys once per Mac, inside the app.
4. One command on this Mac makes a new `.dmg` after a code change.
5. The dev setup (`npm run dev` on port 4321) keeps working unchanged.

## Non-goals

- **Sharing the app with other people.** That needs an Apple Developer account ($99 a year),
  signing and notarising. For Tim's own two Macs, a one-time "Open Anyway" is enough.
- **Syncing packs between the two Macs.** Packs, backups and rules stay in `~/.iconmaschine` on
  each Mac. Each Mac has its own Maschine library, so most packs do not apply to the other one.
- **Automatic updates.** These need signing and a place to publish builds. Tim copies a new
  `.dmg` by hand.
- **Windows.** The code has some Windows paths, but nothing here builds or tests for Windows.
- **A menu bar app or a background server.** The server runs only while the app window is open.

## How it works

```
iconmaschine.app
├── Electron (its own Node 24 and a Chromium window)
└── the Next.js standalone server
```

1. Tim opens the app. Electron starts the Next.js server inside the app on `127.0.0.1`, on a free
   port that it picks.
2. When the server answers, Electron opens a window on that address.
3. When Tim quits the app, the server stops with it.

An analogy: today, Tim opens a restaurant (the server) by hand each morning, then walks in as a
customer (the browser). The app is a vending machine. It turns on when he presses the button, and
it switches off when he walks away.

## User stories

- As Tim, on my other Mac, I want to copy one file and open the app, so that I can use
  iconmaschine there without setting up a dev environment.
- As Tim, I want to open the app from the Dock, so that I never start a server by hand.
- As Tim, I want to paste my OpenAI and SerpAPI keys into the app once, so that AI artwork and
  logo search work without a `.env.local` file.
- As Tim, after I change the code, I want one command to make a new `.dmg`, so that I can update
  the other Mac.
- As Tim, if NI Resources or Maschine 3 is missing on a Mac, I want the app to say so, so that I
  know what to install. (The status chips already do this.)
- As Tim, I want copy, paste and undo to work in every text field, as they do in a browser.

## Requirements

### Must-have (P0)

**R1. A Mac app that runs the server itself.** Opening `iconmaschine.app` starts the server and
shows the app in its own window. Quitting the app stops the server.

- Given the app is closed, when Tim opens it, then the step layout shows within 5 seconds.
- Given the app is open, when Tim quits it, then no iconmaschine server process is left running.
- The server listens on `127.0.0.1` only, never on the network.
- A second open of the app focuses the open window. It does not start a second server.
- If the server fails to start, the window shows the error and the log path. It is not a blank
  window.

**R2. Every feature works in the app.** A check on the packaged app covers: build a pack, install
it to NI Resources, the sample tags step, preset tags, Calibrate, AI artwork, logo search and the
`.zip` download.

- The `.zip` download opens a save dialog.
- Links to other sites (for example serpapi.com) open in Tim's normal browser, not in the app.

**R3. Keys stored by the app.** A Settings page in the app holds the OpenAI key, the SerpAPI key
and the optional image model.

- The keys are saved in `~/.iconmaschine/settings.json`, readable only by Tim's user account
  (file mode 600).
- The page shows whether each key is set. It never shows a saved key in full.
- An environment variable, where one is set, still wins over the saved value. This keeps the dev
  setup working with `.env.local`.
- A new key takes effect without a restart of the app.

**R4. A one-command build.** `npm run app` on this Mac makes `dist/iconmaschine-<version>.dmg`.

- The `.dmg` contains no `.env.local`, no keys and no files from `~/.iconmaschine`.
- The build fails with a clear message if a check fails. It does not make a `.dmg` that is
  broken.

**R5. Normal Mac behaviour.** The app has the standard App, Edit, View and Window menus.

- Cmd+C, Cmd+V, Cmd+X, Cmd+A and Cmd+Z work in every text field. (Electron does not give these
  for free. They come from the Edit menu.)
- Cmd+Q quits. Cmd+W closes the window.
- The app has the iconmaschine icon in the Dock and in Finder.

**R6. First open on the other Mac.** A short section in the README says how to install the app on
a second Mac.

- Copy the `.dmg` (AirDrop, USB or iCloud Drive), drag the app to Applications, then use System
  Settings, Privacy & Security, "Open Anyway" the first time.
- macOS will ask for access to the Documents folder the first time the app reads presets in
  `~/Documents/Native Instruments/User Content`. Sample folders on the Desktop or on an external
  drive give the same kind of prompt. Tim clicks Allow.
- Run Calibrate once on the new Mac.

**R7. Dev mode unchanged.** `npm run dev`, `npm test` and `npx tsc --noEmit` work as before, and
port 4321 stays the dev port.

### Nice-to-have (P1)

- **Window position.** The app remembers its window size and position.
- **Version in the app.** The drawer shows the app version and build date, so Tim can see which
  build each Mac has.
- **Open the data folder.** A Settings button opens `~/.iconmaschine` in Finder.

### Future considerations (P2)

- Signing and notarising, if the app is ever shared. The build should accept a signing identity
  later without a redesign.
- Automatic updates from GitHub Releases. This needs signing first.
- Keys in the macOS Keychain in place of the settings file.
- Export and import of packs between Macs.

## Success measures

This is a tool for one person, so the measures are checks, not metrics:

- On the other Mac, Tim goes from "copied the `.dmg`" to "pack installed in Maschine" with no
  terminal.
- A fresh `npm run app` takes less than 5 minutes on this Mac.
- After two weeks of use, Tim has not had to open a terminal to start iconmaschine.

## Open questions

1. **Tim (blocking):** Does the other Mac have Apple Silicon (M1 or later) or an Intel chip? This
   PRD assumes Apple Silicon, the same as this Mac. An Intel Mac needs an x64 build, and a
   build for both chips is about twice the size.
2. **Tim (not blocking):** Is Maschine 3 installed on the other Mac, with the same libraries? The
   app works without them, but the sample tags and Calibrate steps then have nothing to read.
3. **Engineering (not blocking):** Run the server in Electron's main process or in a separate
   `utilityProcess`. A separate process keeps a server crash from closing the window. The plan
   decides.

## Phasing

1. The app shell: R1, R5 and R4 (the build command). Check that it opens and runs on this Mac.
2. Settings for keys (R3) and the feature check (R2).
3. Second Mac: R6. Tim copies the `.dmg` to the other Mac and opens it.
4. P1 items, if wanted.
