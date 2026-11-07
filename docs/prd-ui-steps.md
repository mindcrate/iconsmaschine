# PRD: A step-driven layout with a side drawer

Status: approved by Tim, 2026-11-07.

## Problem statement

The app is one long page with 11 sections stacked top to bottom: A Kit type, B Name it, B2 Browser
entry, C Artwork, T Text on the logos, D Pack details, E Review and install, Your packs, Preset
tags, Batch preset tags and Calibrate. Each one is always on screen, in that order, whatever Tim is
doing.

Three things go wrong as a result:

- **Nothing shows where Tim is.** After a build, the preview and install sit far down the page.
  Tim scrolls past artwork and details to reach them, and back up to change one field.
- **Steps that are not ready still look ready.** Artwork, details and install show before a kit
  type or name is set. Most of the "why is this empty" moments come from using a step too early.
  The sample tags panel says "Maschine lists no WAV files" for 99Sounds, for example.
- **Every tool shows for every kit.** Preset tags and Batch preset tags edit `.nksf`, `.nksn` and
  `.nksfx` presets. Those belong to plugins and Kontakt instruments, yet they also show for a sample
  kit or a Group. B2 Browser entry already hides for anything but a plugin. Nothing else follows
  that rule.

## Goals

1. Tim always sees which step he is on, which steps are done and which are next.
2. A step opens only when the steps it depends on are complete. A locked step says what it needs.
3. Each kit type shows only the steps and tools that apply to it.
4. An existing pack opens with every completed step available, so editing one field is one click.
5. No feature is lost. Every control on the page today has a place in the new layout.

## Non-goals

- **A visual redesign.** Colours, fonts and the dark theme stay. This is about structure.
- **New features inside the steps.** Each panel keeps its current controls, moved, not rewritten.
- **Packaging as a Mac app.** That is a separate decision, covered at the end of this document.
- **Several packs open at once.** One pack at a time, as now.
- **Saving a half-made pack.** A pack still saves at "Build the images", as now.

## The layout

```
┌──────────────────────────┬──────────────────────────────────────────────┐
│ iconmaschine             │  Step 3 of 6 · Artwork                        │
│                          │                                              │
│ BUILD A PACK             │  [ the current step's panel, alone ]         │
│ ✓ 1 Kit type             │                                              │
│ ✓ 2 Name it              │                                              │
│ ● 3 Artwork              │                                              │
│ ○ 4 Text on the logos    │                                              │
│   (optional)             │                                              │
│ 🔒 5 Details             │                                              │
│ 🔒 6 Review and install  │                                              │
│                          │                                              │
│ TOOLS FOR PLUGINS        │                                              │
│   Preset tags            │                                              │
│   Batch preset tags      │                                              │
│                          │                                              │
│ ─────────────            │                                              │
│   Your packs (19)        │  [ Back ]                      [ Next step ] │
│   Calibrate              │                                              │
│ ● NI Resources writable  │                                              │
└──────────────────────────┴──────────────────────────────────────────────┘
```

- The drawer on the left lists the steps for the chosen kit type, then the tools for that kit type,
  then the pages that apply to every pack (Your packs, Calibrate). The status chips move to the
  bottom of the drawer.
- The main area shows one step at a time, with Back and Next at the bottom.
- Each step shows one of four states: done (✓), current (●), open but not done (○) or locked (🔒).
- A locked step can be clicked. It shows what it needs, for example "Name the pack first", with a
  link to that step.
- Below 900 px wide, the drawer folds into a top bar with the current step and a menu button.

## Steps and what unlocks them

| # | Step | Kit types | Done when | Unlocks after |
|---|---|---|---|---|
| 1 | Kit type | all | a kit type is chosen | always open |
| 2 | Name it | all | product name valid; for plugins also vendor | 1 |
| 2b | Browser entry (today's B2) | plugin | file type and at least one category | 2 |
| 3 | Artwork | all | an artwork image is set | 2 (and 2b for plugins) |
| 4 | Text on the logos | all | optional, never blocks | 3 |
| 5 | Details | all | always valid (every field has a default) | 3 |
| 6 | Review and build | all | images built | 3 |
| 7 | Sample tags | sample kit nested under a vendor | optional, never blocks | 6 |
| 8 | Install | all | installed | 6 |

Today's E "Review and install" splits into Review (6) and Install (8), so a sample kit's tag rules
sit between them as their own step.

## Tools and global pages

| Item | Shown for | Why |
|---|---|---|
| Preset tags | plugin, Kontakt | edits NKS presets (`.nksf`, `.nksn`, `.nksfx`) |
| Batch preset tags | plugin, Kontakt | same files, many at once |
| Your packs | always | opens or deletes any pack |
| Calibrate | always | reads installed libraries, not one pack |

Opening a pack from Your packs sets its kit type, marks the completed steps done and goes to Review
(6), or to Install (8) if it was installed before.

## User stories

- As Tim, starting a new pack, I want to see only step 1 and the locked steps after it, so that I
  know what to do first.
- As Tim, I want a locked step to tell me what it needs, so that I am never stuck on a blank panel.
- As Tim, I want to open an old pack and jump straight to Install, so that a re-install is two
  clicks.
- As Tim, I want to change only the artwork of a built pack and come back to Review, so that I don't
  scroll past every other section.
- As Tim, building a sample kit, I don't want to see preset tools I can't use on it.
- As Tim, building a plugin pack, I want Preset tags in the drawer, so that tagging the plugin's
  presets is part of the same job.
- As Tim, on a laptop screen, I want the drawer to fold away, so that the step has room.

## Requirements

### Must-have (P0)

**R1. One step at a time.** The main area shows only the current step. Back and Next move through
the open steps in order. Next is disabled on a step that is not done, with the reason next to it.

**R2. The drawer.** It lists the steps for the current kit type, with their state (done, current,
open, locked). Clicking any open step goes to it.

**R3. Locking from one table.** One step table, as above, decides each step's kit types, its
"done" test and its "unlocks after" list. The drawer, Back/Next and the locked messages all read it.
Adding a step or a kit type is then one row, not edits in several places.

**R4. Locked messages.** A locked step shows "This needs: Name it" (and so on) with a link to each
missing step. It never shows its own controls.

**R5. Context by kit type.** Steps and tools not in the current kit type's rows do not show. A kit
type change that hides the current step moves Tim to the nearest open step.

**R6. Opening a pack.** Loading a saved pack sets every step's state from the pack's data and goes
to Review, or Install for an installed pack.

**R7. Nothing lost.** Every control from today's page is in exactly one step, tool or global page.
The plan lists each control and where it went.

**R8. Narrow screens.** Below 900 px, the drawer becomes a top bar with a menu. No horizontal scroll.

### Nice-to-have (P1)

- **Step in the address.** The current step goes in the URL (`#artwork`), so a reload or the
  browser's back button keeps Tim's place.
- **Changed after build.** After a build, a step whose fields changed shows a dot, and Review says
  "Rebuild to see the changes".
- **Keyboard.** Alt+Up and Alt+Down move between steps.

### Future considerations (P2)

- Open preset tools straight onto the current plugin's presets, filtered by vendor and product.
- A first-run checklist (keys, NI Resources, calibration) in place of the status chips.

## Open questions

1. **Tim:** Preset tags for Kontakt as well as plugins? Kontakt instruments use NKS presets
   (`.nksn` snapshots, `.nksf`). This PRD assumes yes. (Not blocking.)
2. **Tim:** Should "Your packs" be the start screen when the app opens, with "New pack" as its first
   button? This PRD assumes the app opens on step 1 of a new pack, as now. (Not blocking.)
3. **Engineering:** `src/app/page.tsx` is 982 lines and holds the state for every step. The plan
   should split it into one component per step around a shared pack state. That decision belongs
   to the plan, not this PRD. (Not blocking.)

## Timeline and phasing

1. Step table, drawer and one-step-at-a-time view, with today's panels moved in unchanged (R1 to R4,
   R7).
2. Context rules, opening a pack and narrow screens (R5, R6, R8).
3. P1 items, if wanted after Tim has used it.

## Separate topic: how the app lives

Today it is a local web app. `npm run dev` starts a Next.js server on this Mac, and Tim opens
`http://localhost:4321` in a browser. It has to run on the Mac itself, because it reads and writes
NI Resources, Maschine's database and the sample folders. A hosted website cannot reach those.

Three ways to make it feel like a Mac app:

| Option | What it is | Effort | Trade-offs |
|---|---|---|---|
| Launcher | A small `.app` (or login item) that starts the server and opens the browser tab | small | Still a browser tab. Needs Node installed. |
| Electron | A real Mac app bundling Node, the built Next.js server and its own window | medium | About 200 MB. Works with `sharp` and the SQLite reader as they are. Needs signing and notarising to share without Gatekeeper warnings. |
| Tauri | A Mac app using the system's web view, with the Node server as a sidecar | larger | Much smaller download, but the Node server must be bundled as a separate binary, which is the hard part here. |

Recommendation: a launcher now if the app stays personal, and Electron if it is to be shared. This
needs its own PRD, after the layout work, because the layout does not depend on it.
