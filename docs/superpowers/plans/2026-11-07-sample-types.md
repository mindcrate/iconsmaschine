# Sample TYPES, CHARACTERS and One-shot or Loop: Implementation Plan

> **For agentic workers:** Build this with `pstack:poteto-mode` (Tim's rule for this repo). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At install, write TYPES, CHARACTERS and one-shot or loop into each WAV of a user sample library, from rules per folder that the app suggests from names (PRD: `docs/prd-sample-types.md`).

**Architecture:** The pure WAV tag writer (`src/lib/wavtag.ts`) learns three more keys through one merge function. A new pure module (`src/lib/sampletags.ts`) owns the rule types, rule lookup per folder and the parsing of saved rules. A second pure module (`src/lib/samplesuggest.ts`) turns folder and file names into suggestions from a keyword table in `src/data/sample-keywords.json`. Install and re-tag pass each file's resolved fields to the writer. A new panel above the install panel edits the rules.

**Tech Stack:** Next.js 16.4.5 route handlers (`params: Promise<{id}>`), React client components, `node --test` with `--experimental-strip-types`, `node:sqlite` for Maschine's database (read-only).

**Commands:** tests `npm test`; one file `node --experimental-strip-types --import ./tests/ts-resolver.mjs --test tests/<name>.test.mts`; typecheck `npx tsc --noEmit`.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/wavtag.ts` | modify | `SampleTag` gains optional `fields`; one `mergeSoundInfo` decides the new map; unchanged and read-back checks use it. |
| `src/lib/wavfile.ts` | create | `readSoundInfoAt(file)`: reads only the `ID3 ` chunk of a WAV on disk, for the plan. |
| `src/lib/sampletags.ts` | create | `SampleRule`, `SampleTags`, `EMPTY_SAMPLE_TAGS`, `parseSampleTags`, `folderOf`, `resolveFields`. |
| `src/lib/samplesuggest.ts` | create | `tokens`, `suggestFromName`, `suggestFolders`. |
| `src/data/sample-keywords.json` | create | The keyword table. |
| `src/lib/kits.ts` | modify | `SampleTarget` gains `root`; `userLibrarySamples` also returns `nonWav`. |
| `src/lib/tagvocab.ts` | modify | `sampleTypes` and `sampleCharacters`, ordered by use on WAV files. |
| `src/lib/store.ts` | modify | `Pack.sampleTags`, with a default in `withDefaults`. |
| `src/lib/install.ts` | modify | `InstallInput.sampleTags`; `tagSamples` writes the fields; `planInstall` reports per-folder counts. |
| `src/app/api/packs/[id]/install/route.ts` | modify | Passes `pack.sampleTags` and `nonWav`. |
| `src/app/api/packs/[id]/sample-tags/route.ts` | create | GET folders + suggestions + saved rules; PUT saves rules. |
| `src/components/SampleTagsPanel.tsx` | create | The rules editor. |
| `src/components/InstallPanel.tsx` | modify | Shows the per-folder counts; drops a stale plan when the rules change. |
| `src/app/page.tsx` | modify | Mounts the panel for nested user sample packs. |
| `tests/wavtag.test.mts`, `tests/sampletags.test.mts`, `tests/samplesuggest.test.mts`, `tests/install.test.mts`, `tests/kits.test.mts`, `tests/tagvocab.test.mts`, `tests/packimages.test.mts` | modify / create | Tests per task. |

Change to the PRD's data shape: rule fields are optional, and a missing field takes the parent folder's value. `kind: "keep"` writes no `deviceType`. A new `matchFileNames` flag turns on the per-file name match from R4. The reasons are under Task 3.

---

### Task 1: The tag writer handles types, modes and deviceType (R2)

**Files:** modify `src/lib/wavtag.ts`; test `tests/wavtag.test.mts`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/wavtag.test.mts`:

```ts
const FIELDS = { types: [["Drums", "Kick"]], modes: ["Analog"], deviceType: "LOOP" as const };

test("types, modes and deviceType are written next to the vendor", () => {
  const out = tagSample(realWav(), { ...TAG, fields: { ...FIELDS, replace: false } });
  assert.equal(out.kind, "tagged");
  const info = readSoundInfo((out as { buffer: Buffer }).buffer)!;
  assert.deepEqual(info.types, [["Drums", "Kick"]]);
  assert.deepEqual(info.modes, ["Analog"]);
  assert.equal(info.deviceType, "LOOP");
  assert.equal(info.vendor, "tim moose");
});

test("existing types are kept unless replace is set", () => {
  const input = realWav({ map: nksMap({ types: [["Drums", "Snare"]], bankchain: ["808 COLLECTION"] }) });
  const kept = tagSample(input, { ...TAG, fields: { types: [["Drums", "Kick"]], replace: false } });
  assert.deepEqual(kept, { kind: "unchanged" });
  const replaced = tagSample(input, { ...TAG, fields: { types: [["Drums", "Kick"]], replace: true } });
  assert.deepEqual(readSoundInfo((replaced as { buffer: Buffer }).buffer)!.types, [["Drums", "Kick"]]);
});

test("an empty types list counts as no types, so it is filled", () => {
  const input = realWav({ map: nksMap({ types: [], bankchain: ["808 COLLECTION"] }) });
  const out = tagSample(input, { ...TAG, fields: { types: [["Drums", "Kick"]], replace: false } });
  assert.deepEqual(readSoundInfo((out as { buffer: Buffer }).buffer)!.types, [["Drums", "Kick"]]);
});

test("tagging twice with fields reports unchanged", () => {
  const tag = { ...TAG, fields: { ...FIELDS, replace: true } };
  const once = tagSample(realWav(), tag) as { buffer: Buffer };
  assert.deepEqual(tagSample(once.buffer, tag), { kind: "unchanged" });
});

test("fields the rule leaves out are not touched", () => {
  const input = realWav({ map: nksMap({ modes: ["Vinyl"], deviceType: "ONESHOT" }) });
  const out = tagSample(input, { ...TAG, fields: { types: [["Bass"]], replace: true } }) as { buffer: Buffer };
  const info = readSoundInfo(out.buffer)!;
  assert.deepEqual(info.modes, ["Vinyl"]);
  assert.equal(info.deviceType, "ONESHOT");
});
```

- [ ] **Step 2: Run and see them fail.** `node --experimental-strip-types --import ./tests/ts-resolver.mjs --test tests/wavtag.test.mts`. Expected: the 5 new tests FAIL (no `fields`).

- [ ] **Step 3: Implement.** In `src/lib/wavtag.ts`:

```ts
export interface SampleFields {
  types?: string[][];
  modes?: string[];
  deviceType?: "ONESHOT" | "LOOP";
  /** Overwrite values the file already has. Off: fill only empty ones. */
  replace: boolean;
}

export interface SampleTag {
  vendor: string;
  bankchain: string[];
  name: string;
  fields?: SampleFields;
}

function isEmpty(v: MsgValue | undefined): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** The map a tag turns `current` into. `current` null means the file has no map yet. */
export function mergeSoundInfo(
  current: Record<string, MsgValue> | null,
  tag: SampleTag,
): Record<string, MsgValue> {
  const next: Record<string, MsgValue> = current
    ? { ...current, vendor: tag.vendor, bankchain: tag.bankchain }
    : newMap(tag);
  const f = tag.fields;
  if (!f) return next;
  const set = (key: string, value: MsgValue | undefined) => {
    if (value === undefined) return;
    if (f.replace || isEmpty(next[key])) next[key] = value;
  };
  set("types", f.types);
  set("modes", f.modes);
  set("deviceType", f.deviceType);
  return next;
}

function sameValue(a: MsgValue | undefined, b: MsgValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameMap(a: Record<string, MsgValue>, b: Record<string, MsgValue>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => sameValue(a[k], b[k]));
}
```

In `tagOrThrow`, replace the frame-exists branch body and the two `newMap(tag)` calls:

```ts
      const map = decodeMap(frame);
      const next = mergeSoundInfo(map, tag);
      if (sameMap(map, next)) return { kind: "unchanged" };
      const geob = parseGeob(frame.body)!;
      const body = Buffer.concat([frame.body.subarray(0, geob.prefixLength), encodeSorted(next)]);
      frames = existing.frames.map((f, j) => (j === i ? { ...f, body } : f));
      expected = next;
    } else {
      expected = mergeSoundInfo(null, tag);
      frames = [newNksFrame(expected), ...existing.frames];
    }
  } else {
    expected = mergeSoundInfo(null, tag);
    frames = [newNksFrame(expected)];
  }
```

Declare `let expected: Record<string, MsgValue>;` next to `let frames`. Replace the read-back check with:

```ts
  const written = readSoundInfo(buffer);
  if (!written || !sameMap(written, expected)) {
    throw new WavTagError("the new tag did not read back correctly");
  }
```

Update the doc comment of `tagSample` to say it writes vendor, bankchain and the optional fields. Delete `sameBank` if nothing else uses it.

- [ ] **Step 4: Run the file again.** Expected: all tests PASS, old ones included.

- [ ] **Step 5: Commit.** `git add src/lib/wavtag.ts tests/wavtag.test.mts && git commit -m "Write types, modes and deviceType into a WAV's NI tag"` (plus the Co-Authored-By line).

---

### Task 2: Prove Maschine 3 reads the new keys (R1)

No app code. This is the gate for every later task.

- [ ] **Step 1: Pick a test file.** In a library Maschine already scanned (Voodoo at `/Volumes/Escapism 2 Samples & Music/SAMPLES/Voodoo/`), copy one WAV to `zz-iconmaschine-test.wav` in the same folder.
- [ ] **Step 2: Rescan in Maschine 3** (Preferences > Library > User > Rescan for that folder). Then copy `komplete.db3` with its `-wal` and `-shm` files to the scratchpad. Query the copy:

```sql
SELECT s.device_type_flags, s.virtualBC,
  (SELECT group_concat(c.category||'>'||ifnull(c.subcategory,''), ';') FROM k_sound_info_category sc JOIN k_category c ON c.id=sc.category_id WHERE sc.sound_info_id=s.id),
  (SELECT group_concat(m.name, ';') FROM k_sound_info_mode sm JOIN k_mode m ON m.id=sm.mode_id WHERE sm.sound_info_id=s.id)
FROM k_sound_info s WHERE s.file_name LIKE '%zz-iconmaschine-test.wav';
```

Expected: flag 4 (one-shot), no types, no modes.

- [ ] **Step 3: Write the tags** with a scratch script that calls `tagSample(buf, { vendor: "MOOSE LIFE", bankchain: ["Voodoo"], name: "zz-iconmaschine-test", fields: { types: [["Drums","Kick"]], modes: ["Analog"], deviceType: "LOOP", replace: true } })` and writes the result back through a temp file and rename.
- [ ] **Step 4: Rescan and query again.** Pass: flag 8, `Drums>Kick`, `Analog`, and `virtualBC` still 0.
- [ ] **Step 5: Clean up.** Delete `zz-iconmaschine-test.wav` (a single file this app made) and rescan. On a fail in Step 4, stop and report to Tim with the query output. Do not start Task 3.

---

### Task 3: Rules per folder (R3, R9)

**Files:** create `src/lib/sampletags.ts`, `tests/sampletags.test.mts`; modify `src/lib/kits.ts`, `tests/kits.test.mts`, `src/lib/store.ts`, `tests/packimages.test.mts`.

Why optional fields: a pack-wide rule of "Analog" with a `Kicks` rule of Drums > Kick should give a kick both values. With whole-rule override, Tim would have to repeat "Analog" on every folder. Why `matchFileNames`: a folder named `Drums` holding `Kick 01.wav` and `Snare 02.wav` has no folder-level answer. The file-name match covers it, and the plan counts make it visible before any write.

- [ ] **Step 1: `SampleTarget.root`.** In `src/lib/kits.ts`, add `root: string;` (the library folder Maschine scanned, `k_content_path.path`) to `SampleTarget`. Set `root` in the `samples.push`. Return the other audio files too: change `AND lower(s.file_ext) = 'wav'` to `AND lower(s.file_ext) IN ('wav','aif','aiff','flac','m4a','mp3','ogg')`, select `s.file_ext AS ext`, and push rows whose `lower(ext) !== "wav"` into `nonWav: SampleTarget[]`. Return `{ samples, nonWav }` (and `nonWav: []` on every early return). Update `tests/kits.test.mts` expectations to include `root: "/Volumes/Music/808"` (or the row's path) and assert `nonWav` holds `loop.aif`.

- [ ] **Step 2: Write the failing tests** in `tests/sampletags.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { folderOf, parseSampleTags, resolveFields, EMPTY_SAMPLE_TAGS } from "../src/lib/sampletags.ts";

const root = "/Lib/Voodoo";
const t = (rel: string) => ({ path: `${root}/${rel}`, root, bankchain: ["Voodoo"] });

test("folderOf is the folder relative to the library root", () => {
  assert.equal(folderOf(t("Kicks/Hard/K1.wav")), "Kicks/Hard");
  assert.equal(folderOf(t("K1.wav")), "");
  assert.equal(folderOf({ path: "/Else/K1.wav", root, bankchain: [] }), "");
});

test("a folder takes each field from its nearest rule that sets it", () => {
  const tags = parseSampleTags({
    rules: { "": { modes: ["Analog"] }, Kicks: { types: [["Drums", "Kick"]] }, "Kicks/Loops": { kind: "loop" } },
    replaceExisting: false,
    matchFileNames: false,
  });
  assert.deepEqual(resolveFields(t("Kicks/Hard/K1.wav"), tags), {
    types: [["Drums", "Kick"]], modes: ["Analog"], replace: false,
  });
  assert.deepEqual(resolveFields(t("Kicks/Loops/L1.wav"), tags), {
    types: [["Drums", "Kick"]], modes: ["Analog"], deviceType: "LOOP", replace: false,
  });
});

test("keep writes no deviceType, and one-shot writes ONESHOT", () => {
  const tags = parseSampleTags({ rules: { "": { kind: "oneshot" }, Raw: { kind: "keep" } }, replaceExisting: true, matchFileNames: false });
  assert.equal(resolveFields(t("A.wav"), tags)?.deviceType, "ONESHOT");
  assert.equal(resolveFields(t("Raw/A.wav"), tags)?.deviceType, undefined);
});

test("no rules and no name match gives no fields at all", () => {
  assert.equal(resolveFields(t("Kicks/K1.wav"), EMPTY_SAMPLE_TAGS), null);
});

test("file names fill a folder with no types when matching is on", () => {
  const tags = parseSampleTags({ rules: {}, replaceExisting: false, matchFileNames: true });
  assert.deepEqual(resolveFields(t("Drums/Snare 02.wav"), tags), { types: [["Drums", "Snare"]], replace: false });
  assert.equal(resolveFields(t("Drums/Groove [94].wav"), tags)?.deviceType, "LOOP");
});

test("parseSampleTags drops what is not valid", () => {
  const tags = parseSampleTags({
    rules: {
      ok: { kind: "loop", types: [["Drums", "Kick"], ["A", "B", "C", "D"], [], "x"], modes: ["Vinyl", 3] },
      bad: "nope",
      "../up": { kind: "loop" },
      weird: { kind: "sideways" },
    },
    replaceExisting: "yes",
  });
  assert.deepEqual(tags, {
    rules: { ok: { kind: "loop", types: [["Drums", "Kick"]], modes: ["Vinyl"] }, weird: {} },
    replaceExisting: false,
    matchFileNames: false,
  });
});

test("a pack with no saved rules writes nothing new, even for a name that would match", () => {
  assert.equal(resolveFields(t("Kicks/Kick 01.wav"), EMPTY_SAMPLE_TAGS), null);
});
```

- [ ] **Step 3: Run and see them fail** (module missing).

- [ ] **Step 4: Implement** `src/lib/sampletags.ts`:

```ts
import path from "node:path";
import type { SampleTarget } from "./kits";
import type { SampleFields } from "./wavtag";
import { suggestFromName } from "./samplesuggest";

export type SampleKind = "oneshot" | "loop" | "keep";

/** Each field left out takes the value of the nearest parent folder's rule. */
export interface SampleRule {
  kind?: SampleKind;
  /** Up to 3 TYPES paths, e.g. [["Drums", "Kick"]]. */
  types?: string[][];
  /** CHARACTERS. Written to the WAV under the key `modes`. */
  modes?: string[];
}

export interface SampleTags {
  /** Keyed by folder path relative to the library root, "/"-separated. "" is the whole pack. */
  rules: Record<string, SampleRule>;
  replaceExisting: boolean;
  /** Guess a file's TYPE and kind from its name where no rule sets them. */
  matchFileNames: boolean;
}

/** Name matching starts off, so a pack nobody set rules for installs exactly as before (R9). */
export const EMPTY_SAMPLE_TAGS: SampleTags = { rules: {}, replaceExisting: false, matchFileNames: false };
const MAX_TYPES = 3;
const KINDS: SampleKind[] = ["oneshot", "loop", "keep"];

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];

function parseRule(v: unknown): SampleRule | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const rule: SampleRule = {};
  if (KINDS.includes(r.kind as SampleKind)) rule.kind = r.kind as SampleKind;
  if (Array.isArray(r.types)) {
    rule.types = r.types
      .map(strings)
      .filter((p) => p.length >= 1 && p.length <= 3)
      .slice(0, MAX_TYPES);
  }
  if (Array.isArray(r.modes)) rule.modes = [...new Set(strings(r.modes))];
  return rule;
}

/** Saved or posted rules, cleaned. Anything not valid is dropped, never thrown. */
export function parseSampleTags(v: unknown): SampleTags {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const rules: Record<string, SampleRule> = {};
  if (o.rules && typeof o.rules === "object") {
    for (const [folder, raw] of Object.entries(o.rules as Record<string, unknown>)) {
      if (folder.split("/").some((s) => s === ".." || s === ".")) continue;
      const rule = parseRule(raw);
      if (rule) rules[folder] = rule;
    }
  }
  return {
    rules,
    replaceExisting: o.replaceExisting === true,
    matchFileNames: o.matchFileNames === true,
  };
}

export function folderOf(target: SampleTarget): string {
  const rel = path.relative(target.root, path.dirname(target.path));
  if (!target.root || rel.startsWith("..") || path.isAbsolute(rel)) return "";
  return rel.split(path.sep).join("/");
}

/** "", "Kicks", "Kicks/Hard" for "Kicks/Hard". */
function lineage(folder: string): string[] {
  const parts = folder ? folder.split("/") : [];
  return ["", ...parts.map((_, i) => parts.slice(0, i + 1).join("/"))];
}

/** The fields to write into one file, or null when nothing applies to it. */
export function resolveFields(target: SampleTarget, tags: SampleTags): SampleFields | null {
  const merged: SampleRule = {};
  for (const f of lineage(folderOf(target))) {
    const rule = tags.rules[f];
    if (!rule) continue;
    if (rule.kind !== undefined) merged.kind = rule.kind;
    if (rule.types !== undefined) merged.types = rule.types;
    if (rule.modes !== undefined) merged.modes = rule.modes;
  }
  if (tags.matchFileNames) {
    const guess = suggestFromName(path.basename(target.path, path.extname(target.path)));
    if (!merged.types?.length && guess.types) merged.types = guess.types;
    if (merged.kind === undefined && guess.kind) merged.kind = guess.kind;
  }

  const fields: SampleFields = { replace: tags.replaceExisting };
  if (merged.types?.length) fields.types = merged.types;
  if (merged.modes?.length) fields.modes = merged.modes;
  if (merged.kind === "loop") fields.deviceType = "LOOP";
  if (merged.kind === "oneshot") fields.deviceType = "ONESHOT";
  return Object.keys(fields).length > 1 ? fields : null;
}
```

Task 4 creates `samplesuggest.ts`, so do Task 4 Steps 1 to 4 before running this file's tests.

- [ ] **Step 5: Pack field (R9).** In `src/lib/store.ts`, import `{ EMPTY_SAMPLE_TAGS, type SampleTags }` from `./sampletags`, add to `Pack`:

```ts
  /** TYPES, CHARACTERS and one-shot or loop rules for a user sample library. */
  sampleTags: SampleTags;
```

and to `withDefaults`'s defaults: `sampleTags: EMPTY_SAMPLE_TAGS,`. In the old-pack test in `tests/packimages.test.mts`, assert `pack.sampleTags` deep-equals `{ rules: {}, replaceExisting: false, matchFileNames: false }`. Check where packs are created (`grep -rn "nestImage:" src`) and add `sampleTags: EMPTY_SAMPLE_TAGS` there so `tsc` passes. `store.ts` importing from `sampletags.ts` imports `path` and `samplesuggest`, which is fine for server code; `page.tsx` must import only types from `store.ts`.

- [ ] **Step 6: Run** `npm test` and `npx tsc --noEmit`. Expected: PASS, clean.

- [ ] **Step 7: Commit** "Store sample tag rules per folder and resolve them per file".

---

### Task 4: Suggestions from names (R4)

**Files:** create `src/data/sample-keywords.json`, `src/lib/samplesuggest.ts`, `tests/samplesuggest.test.mts`.

- [ ] **Step 1: The keyword table** `src/data/sample-keywords.json`. First match wins, so specific entries come first. A word with `+` needs all its parts in the name.

```json
{
  "types": [
    { "words": ["open+hat", "open+hihat", "open+hh", "ohh", "oh", "openhat"], "type": ["Drums", "Hi-Hat Open"] },
    { "words": ["closed+hat", "closed+hihat", "closed+hh", "chh", "closedhat"], "type": ["Drums", "Hi-Hat Closed"] },
    { "words": ["rim", "rimshot"], "type": ["Drums", "Snare Rimshot"] },
    { "words": ["kick", "kik", "kck", "bd", "bassdrum"], "type": ["Drums", "Kick"] },
    { "words": ["snare", "snr", "sd"], "type": ["Drums", "Snare"] },
    { "words": ["clap", "clp"], "type": ["Drums", "Clap"] },
    { "words": ["hat", "hh", "hihat", "hi+hat"], "type": ["Drums", "Hi-Hat"] },
    { "words": ["crash"], "type": ["Drums", "Crash Cymbal"] },
    { "words": ["ride"], "type": ["Drums", "Ride Cymbal"] },
    { "words": ["cymbal"], "type": ["Drums", "Cymbal"] },
    { "words": ["tom"], "type": ["Drums", "Tom"] },
    { "words": ["shaker"], "type": ["Percussion", "Shaker"] },
    { "words": ["tambourine", "tamb"], "type": ["Percussion", "Tambourine"] },
    { "words": ["conga"], "type": ["Percussion", "Conga"] },
    { "words": ["cowbell"], "type": ["Percussion", "Cowbell"] },
    { "words": ["perc", "percussion"], "type": ["Percussion"] },
    { "words": ["808", "bass", "sub"], "type": ["Bass"] },
    { "words": ["vox", "vocal", "voice", "acapella"], "type": ["Vocal"] },
    { "words": ["riser", "sweep", "uplifter", "downlifter"], "type": ["Sweep & Swell"] },
    { "words": ["fx", "sfx"], "type": ["Sound Effects"] },
    { "words": ["piano", "keys", "rhodes"], "type": ["Piano / Keys"] },
    { "words": ["guitar", "gtr"], "type": ["Guitar"] },
    { "words": ["pad"], "type": ["Synth Pad"] },
    { "words": ["drum", "drums"], "type": ["Drums"] }
  ],
  "loop": ["loop", "loops", "groove", "break", "breaks"],
  "oneshot": ["oneshot", "oneshots", "one+shot", "one+shots", "hit", "hits"]
}
```

- [ ] **Step 2: Failing tests** `tests/samplesuggest.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestFolders, suggestFromName, tokens } from "../src/lib/samplesuggest.ts";

test("names split on case, digits and punctuation, with plurals folded", () => {
  assert.deepEqual(tokens("808Bass_Kicks-01"), ["808", "bass", "kick", "01"]);
  assert.deepEqual(tokens("OpenHat"), ["open", "hat"]);
});

test("drum words give Maschine's TYPES", () => {
  assert.deepEqual(suggestFromName("Kick 01").types, [["Drums", "Kick"]]);
  assert.deepEqual(suggestFromName("TR909 OH 3").types, [["Drums", "Hi-Hat Open"]]);
  assert.deepEqual(suggestFromName("Open Hat").types, [["Drums", "Hi-Hat Open"]]);
  assert.deepEqual(suggestFromName("HH_closed").types, [["Drums", "Hi-Hat Closed"]]);
  assert.deepEqual(suggestFromName("Hat 4").types, [["Drums", "Hi-Hat"]]);
  assert.deepEqual(suggestFromName("808 Kick").types, [["Drums", "Kick"]]);
  assert.equal(suggestFromName("Gm - P78_001").types, undefined);
});

test("loop words and tempos mark a loop", () => {
  assert.equal(suggestFromName("Synth[160] C Eclipse").kind, "loop");
  assert.equal(suggestFromName("Groove 94bpm").kind, "loop");
  assert.equal(suggestFromName("Drums_120_Am").kind, "loop");
  assert.equal(suggestFromName("Kick 01").kind, undefined);
  assert.equal(suggestFromName("Snare_1000_x").kind, undefined);
});

test("a type the vocabulary lacks falls back to its parent, or is dropped", () => {
  const known = new Set(["Drums", "Bass"]);
  assert.deepEqual(suggestFromName("Kick 01", known).types, [["Drums"]]);
  assert.equal(suggestFromName("Vox 1", known).types, undefined);
});

test("folders are suggested from their own name and their parents' loop words", () => {
  const s = suggestFolders([
    { folder: "Kicks", files: ["K1", "K2"] },
    { folder: "Loops/Drums", files: ["A", "B"] },
    { folder: "Misc", files: ["X [90]", "Y [92]", "Z [94]", "W [96]", "V"] },
    { folder: "Stuff", files: ["X", "Y"] },
  ]);
  assert.deepEqual(s.Kicks, { types: [["Drums", "Kick"]] });
  assert.deepEqual(s["Loops/Drums"], { kind: "loop", types: [["Drums"]] });
  assert.deepEqual(s.Misc, { kind: "loop" });
  assert.equal(s.Stuff, undefined);
});
```

- [ ] **Step 3: Run and see them fail.**

- [ ] **Step 4: Implement** `src/lib/samplesuggest.ts`:

```ts
import keywords from "../data/sample-keywords.json" with { type: "json" };
import type { SampleKind, SampleRule } from "./sampletags";

const TEMPO = /\[(\d{2,3})\]|(?:^|[^\d])(\d{2,3})\s?bpm|_(\d{2,3})_/i;
const MIN_BPM = 60;
const MAX_BPM = 200;
/** Share of a folder's files with a tempo in the name before the folder counts as loops. */
const LOOP_SHARE = 0.8;

export function tokens(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

function hasWord(words: string[], entry: string): boolean {
  const parts = entry.split("+");
  return parts.every((p) => words.includes(p) || words.includes(p.replace(/s$/, "")));
}

function hasTempo(name: string): boolean {
  const m = TEMPO.exec(name);
  const bpm = m ? Number(m[1] ?? m[2] ?? m[3]) : 0;
  return bpm >= MIN_BPM && bpm <= MAX_BPM;
}

function knownOrParent(type: string[], known?: Set<string>): string[] | null {
  if (!known) return type;
  for (let n = type.length; n > 0; n--) {
    const p = type.slice(0, n);
    if (known.has(p.join(" > "))) return p;
  }
  return null;
}

/**
 * A guess from one name. `known` holds the TYPES paths Maschine has, joined
 * with " > "; a guess outside it falls back to its parent, or is dropped.
 */
export function suggestFromName(name: string, known?: Set<string>): { types?: string[][]; kind?: SampleKind } {
  const words = tokens(name);
  const out: { types?: string[][]; kind?: SampleKind } = {};
  for (const e of keywords.types) {
    if (e.words.some((w) => hasWord(words, w))) {
      const t = knownOrParent(e.type, known);
      if (t) out.types = [t];
      break;
    }
  }
  if (keywords.loop.some((w) => hasWord(words, w)) || hasTempo(name)) out.kind = "loop";
  else if (keywords.oneshot.some((w) => hasWord(words, w))) out.kind = "oneshot";
  return out;
}

/** Suggested rules for folders, from the folder's name, its parents' loop words and its files' tempos. */
export function suggestFolders(
  folders: { folder: string; files: string[] }[],
  known?: Set<string>,
): Record<string, SampleRule> {
  const out: Record<string, SampleRule> = {};
  for (const { folder, files } of folders) {
    if (!folder) continue;
    const segments = folder.split("/");
    const rule: SampleRule = {};
    const own = suggestFromName(segments[segments.length - 1], known);
    if (segments.some((s) => suggestFromName(s).kind === "loop")) rule.kind = "loop";
    else if (own.kind) rule.kind = own.kind;
    else if (files.length > 0 && files.filter(hasTempo).length / files.length >= LOOP_SHARE) rule.kind = "loop";
    if (own.types) rule.types = own.types;
    if (Object.keys(rule).length > 0) out[folder] = rule;
  }
  return out;
}
```

If `with { type: "json" }` fails under the test runner or `tsc`, check how `src/lib/vocab.ts` loads `src/data/vendor-suggestions.json` and copy that.

- [ ] **Step 5: Run** both new test files and `npm test`. Expected: PASS. Adjust the table, not the tests, when a real name is mis-guessed.

- [ ] **Step 6: Commit** "Suggest sample tags from folder and file names".

---

### Task 5: Maschine's names, by use on WAVs (R5)

**Files:** modify `src/lib/tagvocab.ts`, `tests/tagvocab.test.mts`.

- [ ] **Step 1: Failing test.** In `tests/tagvocab.test.mts`, build a fixture DB with `k_category` holding "Drums/Hi-Hat Closed" and "Drums/Hihat Closed", `k_sound_info` holding 3 WAVs, and `k_sound_info_category` linking 2 of them to "Hihat Closed" and 1 to "Hi-Hat Closed". Do the same for two `k_mode` names. Assert `vocab.sampleTypes[0]` is `["Drums", "Hihat Closed"]` and `vocab.sampleTypes` holds every path in `vocab.types`. Assert the same order for `sampleCharacters`. Follow the fixture style of the existing tests in that file.

- [ ] **Step 2: Implement.** Add `sampleTypes: string[][]` and `sampleCharacters: string[]` to `TagVocabulary`, with these readers:

```ts
function usage(db: Db, sql: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of tryAll(db, sql)) m.set(String(r.k), Number(r.n));
  return m;
}

const byUse = <T>(items: T[], key: (t: T) => string, used: Map<string, number>) =>
  [...items].sort((a, b) => (used.get(key(b)) ?? 0) - (used.get(key(a)) ?? 0));

const WAV_TYPE_USE = `SELECT json_array(c.category, c.subcategory, c.subsubcategory) AS k, count(*) AS n
  FROM k_sound_info s JOIN k_sound_info_category sc ON sc.sound_info_id = s.id
  JOIN k_category c ON c.id = sc.category_id
  WHERE lower(s.file_ext) = 'wav' GROUP BY c.id`;
const WAV_MODE_USE = `SELECT m.name AS k, count(*) AS n
  FROM k_sound_info s JOIN k_sound_info_mode sm ON sm.sound_info_id = s.id
  JOIN k_mode m ON m.id = sm.mode_id
  WHERE lower(s.file_ext) = 'wav' GROUP BY m.id`;
```

The type key must match `JSON.stringify(parts)` with empty parts dropped, so map the `json_array` result through `JSON.parse`, filter empty and null entries, and stringify again before `m.set`. `Array.prototype.sort` is stable, so ties keep the alphabetical order of `types`. Set `sampleTypes = byUse(types, (t) => JSON.stringify(t), typeUse)` and the same for characters. Use the fallback lists for both in every fallback return. Add `"v2:"` to the start of `cacheKey`'s result, so caches without the new fields are not read.

- [ ] **Step 3: Run** `npm test`, `npx tsc --noEmit`. **Commit** "Order sample TYPES and CHARACTERS by how often WAVs use them".

---

### Task 6: Install and re-tag write the fields, and the plan counts them (R6, R7, R8)

**Files:** create `src/lib/wavfile.ts`; modify `src/lib/install.ts`, `tests/install.test.mts`, `src/app/api/packs/[id]/install/route.ts`.

- [ ] **Step 1: `readSoundInfoAt`.** `src/lib/wavfile.ts`:

```ts
import fs from "node:fs/promises";
import type { MsgValue } from "./msgpack";
import { readSoundInfo } from "./wavtag";
import { serialiseRiff } from "./riff";

/**
 * The NI sound info of a WAV on disk, reading only its chunk headers and its
 * ID3 chunk. A plan over thousands of files must not read their audio.
 */
export async function readSoundInfoAt(file: string): Promise<Record<string, MsgValue> | null> {
  const fh = await fs.open(file, "r");
  try {
    const head = Buffer.alloc(12);
    await fh.read(head, 0, 12, 0);
    if (head.toString("latin1", 0, 4) !== "RIFF" || head.toString("latin1", 8, 12) !== "WAVE") return null;
    const end = 8 + head.readUInt32LE(4);
    const h = Buffer.alloc(8);
    for (let at = 12; at + 8 <= end; ) {
      const { bytesRead } = await fh.read(h, 0, 8, at);
      if (bytesRead < 8) return null;
      const id = h.toString("latin1", 0, 4);
      const size = h.readUInt32LE(4);
      if (id.toLowerCase() === "id3 ") {
        const data = Buffer.alloc(size);
        await fh.read(data, 0, size, at + 8);
        return readSoundInfo(serialiseRiff({ form: "WAVE", chunks: [{ id, data }] }));
      }
      at += 8 + size + (size & 1);
    }
    return null;
  } finally {
    await fh.close();
  }
}
```

Test it in `tests/install.test.mts` (or a new `tests/wavfile.test.mts`): a WAV tagged by `tagSample` reads back the same map from disk; an untagged one gives null.

- [ ] **Step 2: Failing install tests.** In `tests/install.test.mts`, change `sampleLibrary` so each target carries `root: base` and files may sit in sub-folders (`names` like `"Kicks/k1.wav"`, made with `fs.mkdir(path.dirname(p), { recursive: true })`). Add:

```ts
test("install writes each folder's rule into its files", async (t) => {
  const { base } = await tempRoot(t);
  const { install } = await import("../src/lib/install.ts");
  const { readSoundInfo } = await import("../src/lib/wavtag.ts");
  const lib = await sampleLibrary(base, ["Kicks/k1.wav", "Loops/l1.wav"]);
  const sampleTags = {
    rules: { Kicks: { types: [["Drums", "Kick"]] }, Loops: { kind: "loop" as const } },
    replaceExisting: false,
    matchFileNames: false,
  };
  await install({ ...packInput(lib.targets), sampleTags });
  const k = readSoundInfo(await fs.readFile(lib.targets[0].path))!;
  const l = readSoundInfo(await fs.readFile(lib.targets[1].path))!;
  assert.deepEqual(k.types, [["Drums", "Kick"]]);
  assert.equal(k.deviceType, undefined);
  assert.equal(l.deviceType, "LOOP");
});

test("the plan counts, per folder, files to change and files keeping their own tags", async (t) => {
  // Tag Kicks/k2.wav first with types [["Drums","Snare"]] via tagSample and write it back.
  // Then planInstall with the Kicks rule above and replaceExisting false.
  // Expect plan.sampleTags.folders to include
  //   { folder: "Kicks", files: 2, change: 1, keep: 1 }
  // and every WAV byte-identical to before the plan.
});

test("re-apply tags only writes the rules too", async (t) => {
  // retagSamples({ ...packInput(lib.targets), sampleTags }) then read types back.
});
```

Write the two sketched tests out in full in the same style as the first before running.

- [ ] **Step 3: Implement in `src/lib/install.ts`.**
  - `InstallInput` gains `sampleTags?: SampleTags | null;` and `nonWav?: SampleTarget[] | null;`.
  - `tagSamples(targets, vendor, backupDir, sampleTags)` passes `fields: sampleTags ? resolveFields(target, sampleTags) ?? undefined : undefined` to `tagSample`. Update its three callers (`install`, `retagSamples`, and the plan does not call it).
  - `InstallPlan` gains:

```ts
  /** Per folder: files, how many will change, how many keep their own tags. null with no samples. */
  sampleTags: {
    folders: { folder: string; files: number; change: number; keep: number }[];
    nonWav: number;
  } | null;
```

  - In `wavtag.ts`, export `sameMap`, and add one helper so the writer and the plan share the "keep" rule:

```ts
/** Keys the fields ask to change that the file keeps, because it has its own value and replace is off. */
export function keptKeys(current: Record<string, MsgValue> | null, fields: SampleFields | undefined): string[] {
  if (!current || !fields || fields.replace) return [];
  const asked: [string, MsgValue | undefined][] = [
    ["types", fields.types], ["modes", fields.modes], ["deviceType", fields.deviceType],
  ];
  return asked
    .filter(([k, v]) => v !== undefined && !isEmpty(current[k]) && !sameValue(current[k], v))
    .map(([k]) => k);
}
```

  - In `planInstall`, for each sample: `fields = resolveFields(...) ?? undefined`, `current = await readSoundInfoAt(path).catch(() => null)`, `tag = { vendor, bankchain, name, fields }`, `next = mergeSoundInfo(current, tag)`. `change` counts files where `current` is null or `!sameMap(current, next)`. `keep` counts files where `keptKeys(current, fields).length > 0`. Group by `folderOf`. `nonWav` is `input.nonWav?.length ?? 0`. Count only for nested user packs, the same condition as `samples`.
  - Keep `samples.folders` as it is; the new block sits beside it.

- [ ] **Step 4: Route.** In `install/route.ts`, add `sampleTags: pack.sampleTags` and `nonWav: library?.nonWav ?? null` to `input`.

- [ ] **Step 5: Run** `npm test`, `npx tsc --noEmit`. Expected: PASS. Old tests that compare whole plan objects need `sampleTags` in their expected values; update them.

- [ ] **Step 6: Commit** "Write sample tag rules at install and re-tag, and count them in the plan".

---

### Task 7: The rules API

**Files:** create `src/app/api/packs/[id]/sample-tags/route.ts`; test `tests/packroute.test.mts` (same style as its PUT test).

- [ ] **Step 1: Implement.**

```ts
import path from "node:path";
import { jsonError } from "@/lib/form";
import { userLibrarySamples } from "@/lib/kits";
import { folderOf, parseSampleTags } from "@/lib/sampletags";
import { suggestFolders } from "@/lib/samplesuggest";
import { readPack, savePack } from "@/lib/store";
import { readTagVocabulary } from "@/lib/tagvocab";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** The library's folders with file counts and suggestions, plus the saved rules. */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const pack = await readPack(id);
    if (!pack) return Response.json({ error: "Pack not found." }, { status: 404 });
    const { samples, nonWav, note } = await userLibrarySamples(pack.product);
    const vocab = await readTagVocabulary();
    const known = new Set(vocab.types.map((t) => t.join(" > ")));

    const byFolder = new Map<string, string[]>();
    for (const s of samples) {
      const f = folderOf(s);
      byFolder.set(f, [...(byFolder.get(f) ?? []), path.basename(s.path, path.extname(s.path))]);
    }
    const folders = [...byFolder.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([folder, files]) => ({ folder, files }));
    return Response.json({
      folders: folders.map(({ folder, files }) => ({ folder, files: files.length })),
      suggestions: suggestFolders(folders, known),
      nonWav: nonWav.length,
      sampleTags: pack.sampleTags,
      types: vocab.sampleTypes,
      characters: vocab.sampleCharacters,
      note,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PUT(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const pack = await readPack(id);
    if (!pack) return Response.json({ error: "Pack not found." }, { status: 404 });
    const sampleTags = parseSampleTags(await request.json());
    const saved = await savePack({ ...pack, sampleTags });
    return Response.json({ sampleTags: saved.sampleTags });
  } catch (err) {
    return jsonError(err);
  }
}
```

Folders with only parents in the tree (a folder that holds sub-folders but no files) do not appear. Add each parent of every listed folder with `files: 0`, so a rule can sit on `Loops` for `Loops/Construction/Eclipse Kit`.

- [ ] **Step 2: Test.** PUT junk and get the cleaned rules back; GET on a missing pack returns 404. Run `npm test`. **Commit** "Add the sample tag rules API".

---

### Task 8: The rules panel and the plan display (UI)

**Files:** create `src/components/SampleTagsPanel.tsx`; modify `src/components/InstallPanel.tsx`, `src/app/page.tsx`, `src/app/globals.css`.

- [ ] **Step 1: `SampleTagsPanel`.** Props `{ packId: string; onSaved: () => void }`. On mount, GET `/api/packs/${packId}/sample-tags`. Show:
  - A heading "Sample tags", and one line on what it does ("Written into each WAV at install, so the Maschine browser can filter by TYPE, CHARACTER and one-shot or loop.").
  - A table with one row per folder, "All folders" first (key `""`), indented by depth. Columns: folder name and file count; Kind (`select` with "Same as parent", "One-shot", "Loop", "Leave as is"); TYPES (chips with a remove button, plus a `select` of `types` joined with " > ", at most 3); CHARACTERS (chips plus a `select` of `characters`). "Same as parent" means the field is absent from the rule.
  - Suggested values that are not saved show in a muted style with "suggested" next to them.
  - Buttons: "Suggest from names" (copies each suggestion into its folder's rule where that field is absent, never over a value Tim set), "Save rules" (PUT, then `onSaved()`), and "Clear all rules".
  - Two checkboxes: "Guess a file's TYPE from its name where no rule sets one" (`matchFileNames`, off until Tim ticks it or clicks "Suggest from names", which ticks it) and "Replace tags the files already have" (`replaceExisting`, unticked by default).
  - The `note` from the API in a `.note` box when present, and "N files are not WAV and will be skipped" when `nonWav > 0`.
  - Unsaved changes show "Unsaved changes" beside Save.

- [ ] **Step 2: Install panel.** Add a `rulesVersion?: number` prop. When it changes, clear `plan`, `result` and `retag`. Under the existing samples line, when `plan.sampleTags` is present, list each folder with a non-zero `change` or `keep`: "`Kicks`: 12 files, 12 will change" and "3 keep their own tags". Show `nonWav` as a line when non-zero.

- [ ] **Step 3: Page.** In `src/app/page.tsx`, above `<InstallPanel`, render `<SampleTagsPanel packId={packId} onSaved={() => setRulesVersion((n) => n + 1)} />` when `kitType === "sample_kit" && nestImage && vendor.trim()`. Add `const [rulesVersion, setRulesVersion] = useState(0);` and pass `rulesVersion` to `InstallPanel`.

- [ ] **Step 4: Check in the app.** Start the dev server on 4325 (`.claude/launch.json`). Open the Voodoo pack, then the Decap pack. Confirm: folders list with counts; Suggest fills Kicks-like folders; Save then "Check what will be written" shows per-folder counts; the browser console has no errors. Take a screenshot of the panel.

- [ ] **Step 5: Run** `npm test`, `npx tsc --noEmit`. **Commit** "Add the sample tags panel above install".

---

### Task 9: Real run and PRD check

- [ ] **Step 1:** Ask Tim before writing to a real library. With his OK, set rules on Voodoo, tick backup, Install. Rescan in Maschine 3. Query the database copy as in Task 2 for the Voodoo files: loop folders at flag 8, TYPES present.
- [ ] **Step 2:** Go through the PRD acceptance criteria R1 to R9 and the success measures. Write down each as met, not met or not tested, with the evidence.
- [ ] **Step 3:** Run `pstack:deslop` and `pstack:no-comments` on the diff. Commit any fixes.
