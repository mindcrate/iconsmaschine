# NI Resources image spec — working notes

The authoritative size table lives in `src/lib/spec.ts` and is summarised in the
README. This file records where those numbers came from and what is left to build.

## Provenance

The sizes are **calibrated against 626 Native Instruments libraries** installed
on a real machine, read with the Calibrate feature. They are not taken from
documentation.

That matters, because the published community sources (PresetMagician's NKS
reference, resoundlabs' Maschine custom-graphics guide, maschinetutorials.com,
NI Community NKS2 threads) were wrong on four of the eight files:

| File | Docs said | Reality | Libraries agreeing |
|---|---|---|---|
| `MST_artwork.png` | 134x66 | 134x66 ✓ | 626 |
| `MST_logo.png` | 240x96 | **240x196** | 626 |
| `MST_plugin.png` | 190x75 | **127x70** | 69 |
| `VB_artwork.png` | 96x47 | 96x47 ✓ | 627 |
| `VB_logo.png` | *not documented* | **227x47** | 625 |
| `OSO_logo.png` | 417x64 | **417x65** | 609 |
| `NKS2_hardware_banner.webp` | 1280x212 | 1280x212 ✓ | 227 |
| `NKS2_hardware_banner_1280x152.webp` | 1280x152 | 1280x152 ✓ | 137 |

Native Instruments publishes no public spec for third-party browser images,
which is presumably why the community numbers drifted. A real installed library
is better evidence than any write-up, so Calibrate is the mechanism of record —
re-run it on any machine to re-check against the libraries installed there.

### Notes on the counts

`MST_plugin.png` appears in only 69 libraries against ~626 for the rest. That is
expected: it is the plugin-chain strip image, so only plugin vendors ship it.
69 is the plugin subset, not a weak signal.

The small spread between 625, 626 and 627 is just a handful of libraries
shipping an incomplete image set.

## Settled

- **`color.json` does not exist.** One source described it as setting the
  background colour behind a transparent `VB_logo`. A `find` for it across all
  626 installed libraries returned zero matches, so it is not part of the
  third-party image spec and nothing in this app needs to emit one. Treat any
  write-up that mentions it as stale.

## What this app is still missing (from the walkthrough transcript)

Maschine needs **two** folders per plugin, not one. This app currently builds
only the first:

```
NI Resources/image/<Vendor>/<Plugin>/
    MST_*.png, VB_*.png, OSO_logo.png, NKS2_*.webp
    <Plugin>.meta          <- plain text: name, then the word "image"

NI Resources/dist_database/<Vendor>/<Plugin>/
    categories.json        <- vendor, product, file type, category
    color.json             <- browser background colour, hex
    shortname.json         <- short name shown on hardware
    <Plugin>.meta          <- plain text: vendor, name, then "dist_database"
```

So `color.json` does exist after all — in `dist_database`, not `image`. The
earlier `find` that came back empty was looking in the wrong place (and may also
mean `dist_database` does not exist on that machine yet).

### The `.meta` files are plain text, and the two differ

Both are UTF-8 plain text. The image one carries the plugin name and the literal
word `image`; the dist_database one carries the **vendor** as well and ends with
`dist_database`. The trailing word names the folder the file belongs to.

This confirms that copying a harvested `.meta` verbatim is wrong on two counts:
it carries the donor's name, and an image-folder `.meta` is not interchangeable
with a dist_database one. The app warns about the first; neither is generated
correctly yet.

### Presets must exist, and the vendor must match

Artwork attaches to *content*, not to an empty folder. A preset has to be saved
into `~/Documents/Native Instruments/User Content/<Vendor>/<Plugin>/`, and the
preset's **Vendor** property (browser → Edit → properties) must equal the folder
name exactly — `iZotope`, not `iZotope Inc`.

### Known quirks from the walkthrough

- Quit and relaunch Maschine. Rescan alone often does not pick changes up.
- If artwork shows but the category reads "Other", the vendor does not match.
- Some plugins only resolve with the vendor set to `Native Instruments`, in
  which case `categories.json` and the dist_database `.meta` must say that too.
- If the name resolves but artwork does not, moving the plugin's image folder
  out of its vendor folder to the top level has been reported to fix it — so the
  nesting is not always required on the image side.
- The real browser data lives in `komplete.db3` under Application Support.
  **Maschine manages it; do not edit it directly.**

### Exact formats still unknown

The JSON key names and the precise `.meta` layout must be read from real factory
entries rather than guessed. `scripts/inspect-ni.sh` dumps them verbatim.

## The vendor string must match what Maschine displays

The single most common failure: the folder/Vendor value is the vendor's short
name while Maschine knows it by its full name.

A real case - Serum installed as:

```
image/xfer/serum/          dist_database/xfer/serum/     Vendor: "Xfer"
```

and no artwork appeared, because Maschine groups the plugin under
**"Xfer Records"**. The correct install is:

```
image/xfer records/serum/  dist_database/xfer records/serum/
                                                         Vendor: "Xfer Records"
```

The walkthrough warns about the same trap with "iZotope" vs "iZotope Inc".

**How to read the right string:** in Maschine's plugin browser, the group
heading above the plugin is the vendor Maschine will match on. Use it verbatim,
including spaces and any "Records" / "Inc" / "Audio" suffix.

Either side can be made to match - change the pack to the plugin's vendor, or
change the preset's Vendor property (browser → Edit → properties). Matching the
plugin's own string is less work and survives re-saving presets.

## Preset metadata (.nksf) — format decoded, UI not built

Everything on the GENERAL, TYPES and CHARACTERS tabs lives in the **preset
file**, not in `dist_database`. That is why a preset can keep showing the wrong
vendor however correct its dist_database entry is: the two are independent, and
the preset wins on those tabs.

### The format

A `.nksf` is a **RIFF** container with form `NIKS`:

```
"RIFF" <u32 size> "NIKS"
  "NISI" <u32 size> <u32 version=1> <MessagePack map>   summary info
  "NICA" <u32 size> ...                                 controller assignments
  "PLID" <u32 size> ...                                 plugin id
  "PCHK" <u32 size> ...                                 the plugin's own state
```

The metadata is **MessagePack**, not JSON. From a real Serum preset:

| Key | Value | Shown as |
|---|---|---|
| `author` | `""` | — |
| `bankchain` | `["Serum", "", ""]` | **the lines under GENERAL** |
| `characters` | `[]` | CHARACTERS tab |
| `comment` | `""` | — |
| `deviceType` | `"INST"` | instrument vs effect |
| `name` | `"Serum Future Bass Brass"` | preset name |
| `types` | `[]` | TYPES tab (each entry is a path) |
| `uuid` | `"a6db6796-…"` | — |
| `vendor` | `"Xfer"` | preset vendor |

`bankchain` explains why some plugins show two lines under GENERAL and most show
one — it is a hierarchy, not a single product string.

Note the preset's `vendor` ("Xfer") need not equal the vendor Maschine groups
the *plugin* under ("Xfer Records"). They are separate fields in separate files.

### What is implemented

`src/lib/msgpack.ts` and `src/lib/nksf.ts` read and write this, with the safety
properties set out below already enforced by tests:

- A no-op edit reproduces the file **byte for byte** (`tests/nksf.test.mts`).
- `NICA`, `PLID` and `PCHK` are carried through untouched — the sound data is
  never re-encoded.
- Original map key order is preserved, so a rewrite matches NI's byte layout.
- Unknown keys NI may add in future survive an edit.
- Malformed or non-NKS files are refused with a clear error, never mangled.
- RIFF word-alignment padding and the top-level size header are maintained.

### Confirmed against a second preset

Sonic Charge Microtonic gave the shape Serum does not - a two-entry bankchain
and existing tags:

| Key | Serum | Microtonic |
|---|---|---|
| `bankchain` | `["Serum", "", ""]` | `["Sonic Charge", "Microtonic", ""]` |
| `characters` | `[]` | `["Analog"]` |
| `types` | `[]` | `[["Beatbox"]]` |
| `vendor` | `"Xfer"` | `"Sonic Charge"` |

Note Microtonic's preset vendor is **"Sonic Charge"**, not "Native Instruments".
Where Maschine displays "Native Instruments" for it, that is coming from the
browser database's record of the *plugin*, not from the preset.

### Tag vocabulary

`src/lib/tagvocab.ts` reads the real strings from Maschine's `komplete.db3`.
Schema confirmed against a 354 MB database with 29 tables:

| Table | Rows | Holds |
|---|---|---|
| `k_category` (category, subcategory, subsubcategory) | 1,136 | the **Types** tree |
| `k_mode` (name) | 139 | the **Characters** |
| `k_bank_chain` (bcvendor, entry1, entry2, entry3) | 2,583 | vendor / product chains |

`k_sound_info_category` and `k_sound_info_mode` are join tables with ~190,000
rows each, mapping sounds to tags. They are not the vocabulary and are not
read.

The database belongs to Maschine, so it is opened **read-only in place** — the
option is accepted at runtime even though the bundled typings omit it. If that
fails (a lock, an in-flight WAL) it falls back to reading a temporary copy. A
test hashes the file before and after to prove it is never modified.

Results are cached against the database's size and mtime, so a 354 MB file is
read once rather than on every request, and re-read automatically when Maschine
changes it.

`scripts/inspect-db.sh` dumps the schema, working from a copy.

### Still to do

- A UI for editing vendor, bankchain, types and characters.
- Write to a copy by default; overwrite in place only on an explicit opt-in.
- Harvest the Types and Characters vocabulary from installed presets, the same
  way the plugin categories are read.
- Re-saving a preset from the plugin can revert these fields, so the tool needs
  to be re-runnable over a whole folder.


## AI artwork: model choice and cost

The OpenAI image lineup moves fast. As of November 2026, researched via search
(every official pricing page was blocked from the session that checked, so the
per-image figures below are **derived from token rates, not read off a price
table** — treat them as indicative):

| Model | Status |
|---|---|
| `dall-e-2`, `dall-e-3` | removed 2026-05-12 |
| `gpt-image-1` | shut down 2026-10-23 |
| `gpt-image-1-mini`, `gpt-image-1.5` | retire 2026-12-01 |
| `gpt-image-2` | live |
| `gpt-image-2.5-flare` / `-sunburst` | live, current |

There is **no `mini` variant** in the 2.x line, so after 1 December the cheapest
OpenAI option is `gpt-image-2.5-flare` at `quality: "low"`.

### Quality is the lever, not the model

Roughly, per 1024px image: `low` ~$0.006, `medium` ~$0.05, `high` ~$0.21. That
~35x spread dwarfs any difference between providers at this volume.

For this app the extra fidelity is wasted: the generated image becomes a
417x65 PNG at the largest and 96x47 at the smallest. The resample destroys
exactly the detail the higher tiers pay for. So the default is `low`, and the
dropdown says what the other tiers cost.

`quality` is therefore in the never-drop list alongside `model` and `prompt`.
The current models default to `high`, so shedding `quality` as an
"unknown parameter" would silently buy the 35x tier with no error. A rejected
`quality` fails loudly instead.

### Cheaper alternatives, and why not

FLUX.1 [schnell] runs about $0.003/image on Together.ai (whose endpoint is
deliberately OpenAI-compatible, so the adapter is small) or fal.ai. That halves
the per-image cost — but at a handful of images per session it saves pennies in
exchange for a second API key, a second provider to track, and more code. Not
worth it unless the usage pattern changes, or you want a genuinely different
visual style as a second opinion.


## Sample kits: what a kit is on disk

Surveying a real system settled why the sample-kit case never worked.

### Maschine's own formats are not the NKS container

| Extension | Container | Editable by this app |
|---|---|---|
| `.nksf`, `.nksfx` | RIFF / `NIKS` | yes - vendor, bankchain, types, characters |
| `.mxgrp`, `.mxsnd`, `.mxinst`, `.mxprj`, `.nksn` | `<u32 size> … "hsin" …` | **no** - proprietary, undocumented |

So the preset editor does **not** extend to Groups and Sounds. Writing a
`.mxgrp` would mean reverse-engineering NI's own format, which is a far bigger
job than the NKS container was and carries real risk of corrupting a user's
Groups.

### But a kit may not need a file edit at all

`k_bank_chain.entry1` holds names like `Amplified Funk`, and NI Resources
contains a flat folder `image/amplified funk/`. That suggests **library content
resolves artwork by its bank chain, lowercased** - not by vendor. Vendor is the
plugin path (`image/<vendor>/<product>/` plus a dist_database entry).

If that holds, a user sample kit needs no edit to any Maschine file: it needs an
image folder named after its bank chain. `scripts/match-kits.sh` tests this by
cross-referencing every image folder against every bank chain, and lists the
chains that hold sounds but have no folder - i.e. exactly the kits with no
artwork, and the folder name each one needs.

### Confirmed by correlation, not by string matching

Loosening the comparison changed nothing - 799/799/799 by bank chain and
1178/1178/1178 by vendor, with zero pairs appearing only after normalisation.
So punctuation was never the issue, and the two mechanisms are not competing.

What settled it was the browser itself. Of the Groups visible on one screen,
exactly five showed the generic plug icon instead of artwork:

```
Backyard Jams · Body Mechanik · Bumpin Flava · Indigo Dust · Mother Board
```

Those are precisely the five that `match-kits.sh` reported as having no image
folder. Every other Group on screen - Arcane Attic, Astral Flutter, Caribbean
C., Chromatic F., Conant Gardens and the rest - had both artwork and a matching
folder. A perfect correlation across the whole visible set.

### The rule

| Content | Resolves artwork from |
|---|---|
| has a vendor (plugins, vendor libraries) | `image/<vendor>/<product>/` plus a dist_database entry |
| no vendor (Expansions, user kits) | `image/<bank chain entry1>/`, lowercased, flat |

Maschine's `"Other"` is a catch-all rather than a real vendor, so content tagged
with it is treated as vendor-less.

Names match **exactly** once lowercased - no punctuation stripping, no
whitespace collapsing. `abbey road 60s drummer` and `abbey road 60s drums` are
genuinely different folders.

### What this means for the app

No Maschine file needs editing. A kit's artwork is a folder name, and the names
come from `k_bank_chain.entry1`. So the app reads them directly
(`src/lib/kits.ts`) and lists your kits with sound counts and an artwork flag,
missing ones first - you pick rather than type, which removes the single most
common cause of artwork never appearing.

Several chain rows can share a name (different sub-banks), so they are
collapsed to one kit per folder with the sound counts added up.
