# PRD: TYPES, CHARACTERS and one-shot or loop for sample kits

Status: approved by Tim, 2026-11-07.

## Problem statement

A sample library installed with this app now shows under its vendor heading with artwork in
Maschine 3. Inside that heading, every file still has empty TYPES and CHARACTERS, so the browser
filters (Kick, Snare, Analog, Vinyl) find none of them. Most files also land in the wrong list.
Maschine 3 splits samples into One-shots and Loops, and a file with no tag for this counts as a
one-shot, so a folder of drum loops shows as one-shots.

Today Tim fixes this by hand in the Maschine browser, file by file. Voodoo alone has hundreds of
files, so in practice it does not get done.

## What the evidence shows

Read from Tim's machine on 2026-11-07:

- Maschine 3 reads all three values from the NI sound info tag in each WAV, the same tag the app
  already writes for `vendor` and `bankchain`.
  - TYPES live under the key `types`, as a list of paths such as `[["Drums","Snare"]]`.
  - CHARACTERS live under the key `modes`, such as `["Rimshot","Vinyl"]`. Presets call this
    `characters`; WAVs do not.
  - One-shot or loop lives under the key `deviceType`, with the value `ONESHOT` or `LOOP`. In a scan
    of 400 of Tim's own WAVs, 39 had `LOOP`, 20 had `ONESHOT` and 336 had no key. Maschine's
    database holds every WAV as one-shot (flag 4) or loop (flag 8), so a missing key means one-shot.
- Voodoo files carry `vendor` and `bankchain` from the app and no `deviceType`, and Maschine lists
  them as one-shots.
- Maschine's database lists the names in use. For WAVs the top TYPES include Drums > Kick (6,645
  files), Drums > Snare, Drums > Hi-Hat Closed, Drums > Clap, Percussion, Bass and Vocal. The top
  CHARACTERS include Digital, Acoustic, Analog, Vinyl and Synthetic. The app already reads both lists
  in `src/lib/tagvocab.ts`.
- The database also holds near-duplicate spellings from different vendors, such as "Hi-Hat Closed"
  and "Hihat Closed". Maschine treats them as two separate filters.

Not yet proven: that Maschine picks up a changed `deviceType` on a file it has already scanned.
The `bankchain` change needed a library rescan, and this one probably does too. Requirement R1 tests
this before any UI work.

## Goals

1. Tim can give a whole sample library correct TYPES, CHARACTERS and one-shot or loop in one pass,
   at install, without opening the Maschine browser.
2. A mixed library (kicks, snares and loops in separate folders) gets the right tags per folder, not
   one tag for the whole pack.
3. The app suggests the tags from folder and file names, so Tim mostly checks and confirms.
4. No file loses a tag it already has, unless Tim chooses to replace it.
5. The audio never changes, and the existing backup option covers these writes too.

## Non-goals

- **Tagging NI's own libraries.** Factory files use a different tag frame, and they are not Tim's to
  change.
- **Reading the audio to detect loops or drum types.** Names and folders give good guesses for
  almost no cost. Audio analysis is a separate project.
- **A per-file editor for every file in v1.** Folder rules plus file-name matching cover the common
  case. Per-file overrides are P1.
- **Formats other than WAV.** The tag writer supports WAV only. AIFF, FLAC and MP3 files are counted
  and skipped, as today.
- **Writing to Maschine's database.** The app writes the files. Maschine reads them on a rescan, as
  with the vendor heading.

## User stories

- As Tim, I want to set "Kicks" to Drums > Kick once, so that every file in that folder gets it.
- As Tim, I want a folder of loops marked as loops, so that it shows in Maschine's Loops list.
- As Tim, I want the app to guess the tags from names like `Kick`, `Snare`, `Hat`, `808`, `Loop` and
  `[94]`, so that I only fix the wrong guesses.
- As Tim, I want to add CHARACTERS such as Vinyl or Analog to a folder or to the whole pack, so that
  the browser filters find them.
- As Tim, I want to see how many files each rule will change before I install, so that a wrong rule
  does not hit 2,000 files by surprise.
- As Tim, I want files that already have TYPES to keep them, so that tags I set in Maschine by hand
  stay.
- As Tim, I want "Re-apply tags only" to write these tags too, so that I can fix a rule without
  copying the artwork again.

## Requirements

### Must-have (P0)

**R1. Prove the write first.** Before UI work, write `deviceType: "LOOP"`, one TYPE and one
CHARACTER into one copied test WAV in a scanned user library. Rescan in Maschine 3 and read the
database.
- Then the file shows under Loops, with the TYPE and CHARACTER filters.
- If Maschine ignores a key, this PRD comes back to Tim before more work.

**R2. One tag writer for all fields.** `tagSample` writes `types`, `modes` and `deviceType` next to
`vendor` and `bankchain`, through the same path.
- The audio-identity check and the read-back check cover the new keys.
- A file whose tags already match is reported as unchanged and is not rewritten.
- Keys the app does not set stay as they were.

**R3. Rules per folder.** The pack stores one rule per folder of the library. A rule has a kind
(one-shot, loop, or leave as is), up to 3 TYPES and any number of CHARACTERS. Folders without a rule
take the rule of the nearest parent. A pack-wide rule sits at the top.
- Given `Kicks` = Drums > Kick and a file `Kicks/Hard/K1.wav`, then K1 gets Drums > Kick.

**R4. Suggestions from names.** A Suggest action fills empty rules from folder names, and also matches
file names inside a folder with no rule. The keyword table lives in one data file, so new words are a
one-line change.
- `Kick`, `Kik`, `BD` become Drums > Kick. `Snare`, `SD` become Drums > Snare. `Hat`, `HH`, `Hihat`
  become a Hi-Hat type. `Loop`, `Loops`, or a tempo in the name (`[94]`, `94bpm`, `_120_`) mark a
  loop.
- A suggestion stays a suggestion until Tim saves the rules.

**R5. Only Maschine's own names.** The TYPES and CHARACTERS pickers offer only names already in
Maschine's database (or the built-in list when it cannot be read). Where two spellings exist, the one
on more files comes first.

**R6. Keep existing tags.** By default a file keeps any `types`, `modes` or `deviceType` it already
has, and the app fills only the empty ones. A "Replace existing tags" box changes that for the
whole run.

**R7. Show the count before writing.** The install plan shows, per rule, how many files it will
change, how many it leaves alone because they already have tags, and how many it skips (not WAV).

**R8. Write at install and with "Re-apply tags only".** Both paths write the rules, with the same
backup option and the same per-file report as today.

**R9. Old packs keep working.** A pack with no rules installs exactly as it does now. Reading an old
pack fills an empty rule set, as `readPack` does for other fields.

### Nice-to-have (P1)

- **Per-file overrides.** A list of a folder's files, where Tim can change one file's TYPE or kind.
- **Rules from one pack as a start for another.** Many of Tim's libraries share folder names.
- **Read back.** Show the tags each file has now, from the file, next to what the rule will write.

### Future considerations (P2)

- Audio checks (length, silence at the end) to back up the loop guess.
- AIFF tagging, if the writer grows support for its tag chunk.
- Writing the same tags to `.mxsnd` Sounds and `.mxgrp` Groups.

## Data shape (for the plan)

```ts
type SampleKind = "oneshot" | "loop" | "keep";

interface SampleRule {
  kind: SampleKind;
  types: string[][];    // up to 3, e.g. [["Drums", "Kick"]]
  modes: string[];      // CHARACTERS, written as `modes`
}

interface SampleTags {
  /** Folder path relative to the library root. "" is the pack-wide rule. */
  rules: Record<string, SampleRule>;
  replaceExisting: boolean;
}

// Pack gains: sampleTags: SampleTags  (default { rules: {}, replaceExisting: false })
```

The folder list comes from the same database read that finds the files today
(`userLibrarySamples` in `src/lib/kits.ts`). Each file's folder is its path relative to the library
root.

## Success measures

- After one install of Voodoo, the Maschine browser shows its loop folders under Loops, and the
  Kick filter finds its kicks. Tim does no hand tagging.
- For a library with clear folder names, the suggestions need fewer than 1 change in 10 folders.
- No file's audio changes. The audio-identity check refuses any write that would change it, and no
  write has been refused for that reason in tests on Tim's real libraries.

## Open questions

1. **Tim:** Is per-file editing needed in v1, or are folder rules plus file-name matching enough to
   start? This PRD assumes they are enough. (Not blocking.)
2. **Tim:** When a folder holds both one-shots and loops with no pattern in the names, should the
   default be one-shot (as Maschine does now) or "leave as is"? This PRD assumes one-shot. (Not
   blocking.)
3. **Engineering:** Does Maschine 3 pick up a changed `deviceType` on rescan? R1 answers this.
   (Blocking for R2 onward.)

## Timeline and phasing

1. R1, the proof on one test file. If it fails, stop and report.
2. R2 and R9, the writer and the data shape, with tests.
3. R3 to R7, rules, suggestions and the UI in the sample kit flow.
4. R8, install and re-tag, then a real run on Voodoo with backup on.
