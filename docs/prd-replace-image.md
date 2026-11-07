# PRD: Replace an image after the pack is built

Status: approved by Tim, 2026-11-06.

## Problem statement

After "Build the images", the Review and install step shows the 8 output files. Clicking one opens
the crop editor, and the crop editor can only move and zoom the image that file already uses. To use
a different picture, Tim must scroll back to step C, change the artwork or tick "Use a different image
for the logo files", and build again. That changes every file that uses the same source, not only
the one he looked at.

A pack holds two source images today: the artwork (`source-artwork.png`) and an optional logo
(`source-logo.png`). Each output file is cut from one of them, as `source` in `src/lib/spec.ts`
says. So a banner that needs a wide picture and a square tile that needs a close-up must share one
image, and the crop is the only control.

## Goals

1. Tim can replace the image of any output file from its lightbox, without leaving step E.
2. He can choose the scope of the change: this file only, all artwork files, or all logo files.
3. He can pick the new image from four places: upload, AI, logo search, or a library of images
   already saved in the app.
4. The rest of the pack does not change. Other files, crops, text overlay and install path stay as
   they were.
5. An installed pack picks up the change on the next Install, through the existing plan screen.

## Non-goals

- **Editing pixels.** No drawing, filters or colour changes. The crop editor and the text overlay
  already cover layout.
- **Reading artwork from NI Resources into the library.** Other products' artwork belongs to their
  vendors. The library holds only images saved in this app. (Tim can still upload a file.)
- **Image history and undo per file.** "Use the pack's image" puts a file back on its group's
  source. A full version history is out of scope.
- **Deleting library images.** Images stay with the packs that use them. Cleanup can come later.
- **Changing the 8 output specs.** Sizes, names and formats stay as NI requires.

## User stories

- As Tim, I want to click a preview tile and replace only that file's image, so that the wide banner
  can use a wide picture while the square tiles keep the close-up.
- As Tim, I want to replace the image for all artwork files or all logo files at once, so that I do
  not have to go back to step C to swap the main picture.
- As Tim, I want to pick an image I already used in another pack, so that I do not have to find and
  upload the same file again.
- As Tim, I want to see which files use their own image, so that I know what a group change will
  not touch.
- As Tim, I want to put a file back on the pack's normal image, so that a test does not stick.
- As Tim, when a replace fails (a bad file, a file too small, the AI or search down), I want a clear
  message and the old image kept, so that a failed try never breaks the pack.

## Requirements

### Must-have (P0)

**R1. Replace from the lightbox.** The crop editor gets a "Replace image" action. It opens the
existing picker (upload, AI, logo search) plus a Library tab.
- Given the pack is built, when Tim clicks a tile and chooses Replace image, then the picker opens
  inside the lightbox.
- The AI and search tabs show the same "no key" message as step C when a key is missing.

**R2. Scope choice.** Before the change is saved, Tim picks one scope:
"This file only", "All artwork files" or "All logo files" (the group the file belongs to is the
default).
- "All artwork files" replaces `source-artwork.png`. "All logo files" sets or replaces
  `source-logo.png` and ticks "Use a different image for the logo files".
- "This file only" stores a per-file image and changes nothing else.
- Files that have their own image are not changed by a group replace, and the confirm step says how
  many files it skips.

**R3. Per-file image in the pack.** The pack stores an optional map from output file name to a saved
image. Rendering uses that image for the file when present, otherwise the group source.
- The map is saved with the pack and survives a restart and a rebuild.
- A pack without the map renders exactly as today (old packs keep working).

**R4. Crop reset.** When a file's image changes, its saved crop is cleared, because the old crop
describes the old picture. The lightbox then opens on the new image with the default crop.

**R5. Library.** A Library tab lists every source image saved in the app: each pack's artwork,
logo and per-file images, shown once each (the same bytes appear once).
- Each tile shows the image and the pack it came from.
- Picking one copies it into the current pack, so deleting the other pack later cannot break this
  one.

**R6. Rebuild and mark.** After a replace, the preview rebuilds. Tiles with their own image carry a
small "own image" mark. The lightbox has "Use the pack's image" to remove the per-file image.

**R7. Install.** Nothing new in the install code: the next Install writes the rebuilt files, and the
plan shows them as overwrites, as today.

**R8. Checks.** The same limits as step C apply: image types and the 25 MB upload cap. When the new
image is narrower than the file it feeds (for example under 1280 px for an NKS2 banner), the lightbox
warns that it will look soft. A failed replace keeps the old image and shows the reason.

### Nice-to-have (P1)

- **Before and after.** The lightbox shows the old and the new image side by side before saving.
- **Library search.** A filter by pack name in the Library tab.
- **Drag and drop.** Drop a file onto a tile to start a "This file only" replace.

### Future considerations (P2)

- **Library cleanup.** Remove images that no pack uses any more.
- **Per-file overlay.** Text overlay settings per file, using the same per-file map.
- **Undo history.** Keep earlier images per file, which the map's image IDs make possible.

## Data shape (for the plan)

- `Pack.fileSources?: Record<string, string>` maps an output file name, such as `NKS2_hardware_banner.webp`,
  to an image ID.
- The images are stored in the pack folder as `source-<sha256>.png`, so the same image saved twice
  is stored once.
- `readSources` also returns the per-file images.
- `renderPack` picks the image per spec: `fileSources[file]` first, then the logo or artwork as
  today.
- The library is a read over all pack folders, grouped by hash.

## Success measures

- **Speed.** Replacing one file's image takes under 30 seconds from the lightbox, with no visit to
  step C.
- **Reliability.** Zero broken packs after a failed replace in testing: the old image stays and the
  pack still builds.
- **Old packs.** All 17 saved packs still build and install the same after the change, so no
  existing pack shifts.
- **Use.** Tim uses a per-file image on at least one real pack (for example a wide NKS2 banner) within
  the first week.

## Open questions

- **Library scope (Tim, non-blocking).** I assumed the library means images saved in this app, not
  artwork in NI Resources. Confirm.
- **Default scope (Tim, non-blocking).** I made the file's group the default ("All artwork files"
  for an artwork file). Should "This file only" be the default instead?
- **Logo group when there is no logo (engineering, non-blocking).** For a pack without a logo image,
  "All logo files" creates one and ticks the logo box. The plan should confirm that the render rule
  for logo files (contain vs fill) still behaves well.
- **Overlay on per-file images (engineering, non-blocking).** The text overlay should apply to a
  per-file image the same way. The plan should test it on the NKS2 banner.

## Timeline and phasing

No deadline. One phase, in this order: data shape and render (R3, R4), library read (R5), lightbox
UI (R1, R2, R6), then checks (R8). Each step ends with tests, and the last step ends with a check in
the running app on a copy of a real pack.
