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

## Not built yet — sample tagging

The image pack is only half of what makes third-party content look native in the
Maschine browser. The other half is metadata: Bank / Type / Sub-Type / Mode /
Character tags, which drive the browser's filter columns.

That lives in the sample and preset files themselves (`.nksf` / `.nksn` chunks
and the Maschine browser database), not in `NI Resources/image`, so it is a
genuinely separate subsystem — a different file format, a different install
location, and destructive to get wrong since it rewrites the user's sample files.

Scope when it gets built:

- Read existing tags from `.nksf` / `.nksn` files and show them.
- Bulk-apply Bank / Type / Sub-Type / Mode / Character across a folder.
- Write to a copy by default; never edit originals in place without opt-in.
- Validate against NI's controlled tag vocabulary rather than free text.
