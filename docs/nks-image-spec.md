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

`src/lib/tagvocab.ts` reads the Types and Characters in use from Maschine's
`komplete.db3`. The database belongs to Maschine, so it is **copied to a temp
file and the copy is read** - never opened in place, so there is no lock to
take and no way to write to it. Verified by hashing the source before and
after. A curated list is used if the database is missing, too large, or has a
schema the reader does not recognise, and the UI says which source was used.

`scripts/inspect-db.sh` dumps the real schema, also from a copy.

### Still to do

- A UI for editing vendor, bankchain, types and characters.
- Write to a copy by default; overwrite in place only on an explicit opt-in.
- Harvest the Types and Characters vocabulary from installed presets, the same
  way the plugin categories are read.
- Re-saving a preset from the plugin can revert these fields, so the tool needs
  to be re-runnable over a whole folder.
