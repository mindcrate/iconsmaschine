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

## Still unverified — and currently blocking

Installing the images alone does **not** make a third-party *sample kit* show up
with artwork. Two things beyond this app's current scope appear to be required.

### 1. The `.meta` may carry the library name inside it

Community guidance for the manual method says to rename the `.meta` **and edit
the name inside it with a text editor**. If true, copying a harvested template
verbatim writes the donor library's name into every pack.

The app now detects this: Calibrate records which library the template came
from, and the install plan warns if that name appears in the template bytes.
It does not rewrite the name, because the format may be length-prefixed and a
naive substitution would corrupt it.

`scripts/inspect-ni.sh` dumps a real `.meta` so the format can be settled.

### 2. The content must be tagged with a matching Vendor property

This is the bigger one. The images resolve by **Vendor**, not by folder name
alone: the sounds/groups must carry a Vendor property equal to the folder and
`.meta` name. For NI-approved Kontakt libraries and plugins that vendor comes
baked in, which is why those work with images alone. User sample kits have no
vendor, so nothing resolves to the artwork.

Reported knock-on effects, all unconfirmed:

- Kits only appear in the browser's kit section at all if they are tagged.
- Some users restored missing artwork by setting the vendor to Native
  Instruments, which is a workaround rather than a fix.
- `categories.json` reportedly holds plugin categories and a browser background
  colour, but the real browser data lives in a `komplete.db3` SQLite database
  under Application Support. **That database is managed by Maschine and must not
  be edited directly.**

This makes sample tagging a prerequisite for sample kits, not an optional
phase 2. Plugin and Kontakt packs are unaffected.

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
