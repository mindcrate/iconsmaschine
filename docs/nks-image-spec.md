# NI Resources image spec — working notes

The authoritative version of the size table lives in `src/lib/spec.ts` and is
summarised in the README. This file records where those numbers came from, what
is still unverified, and what is left to build.

## Provenance

Sizes for `MST_artwork`, `MST_logo`, `MST_plugin`, `VB_artwork`, `OSO_logo` and
the NKS2 banners come from the published community documentation of the NKS
format (PresetMagician's NKS reference, resoundlabs' Maschine custom-graphics
guide, maschinetutorials.com, and NI Community NKS2 threads).

Native Instruments does not publish a public spec for third-party browser
images, so none of these are vendor-confirmed. The **Calibrate** feature exists
precisely because a real installed library is better evidence than any of the
above — it reads the libraries on the machine and reports what they actually use.

## Unverified

- **`VB_logo.png` dimensions.** Every source describes what this file does but
  none give a size. `src/lib/spec.ts` marks it `unverified: true`, which surfaces
  a badge in the UI. Calibrate against a real library and correct it.
- **`.meta` contents.** The format is opaque and community guidance is that it
  is not meant to be edited — only the filename has to match. The app therefore
  copies a harvested real `.meta` when one is available, and writes an empty file
  otherwise (which is what the manual tutorials do).
- **`color.json`.** Referenced in one source as setting the background colour
  behind a transparent `VB_logo`. Not implemented; worth checking whether real
  libraries ship one.

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
