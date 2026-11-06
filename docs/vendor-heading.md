# Why a sample library shows no artwork

Measured on one machine running both Maschine 2 and Maschine 3, over a long
investigation that spent most of its time on the wrong variable. Writing it
down so the next person does not repeat it.

## The finding

**Artwork resolves off the browser heading, not the folder.**

The heading is `k_bank_chain.bcvendor`. When it reads `Other`, no artwork
appears no matter where the files are. When it reads a real vendor, or is
blank (which the browser renders as "Native Instruments"), artwork appears
from the folder that heading implies.

The evidence, from `scripts/vendors.sh` against Maschine 3:

```
library            heading   vendor on sounds   artwork on disk
808 COLLECTION     Other     tim moose          image/tim moose/808 collection/  (8 files)
Voodoo             Other     MOOSE LIFE         image/moose life/voodoo/         (8 files)
Maschine 2         Other     Maschine 2         image/maschine 2/                (8 files)
Battery            (blank)   Native Instruments image/battery/                   (7 files)
Caribbean Current  (blank)   Native Instruments image/caribbean current/         (5 files)
```

The first three are exactly the three libraries the browser showed with
generic waveform placeholders. All had a complete set of files in the right
place. The rest displayed. Folder layout did not predict the outcome; the
heading did.

## The Maschine 3 regression

In **Maschine 2**, selecting a bank's sounds and setting Edit > Properties >
Vendor, then Apply, writes the vendor to `bcvendor` on the bank chain. The
library then appears under that heading with its artwork.

In **Maschine 3**, the same action writes the vendor onto the sounds only.
`bcvendor` stays `Other`, and the artwork never appears.

Confirmed both ways on the same libraries: 808 COLLECTION and Voodoo display
correctly in Maschine 2 and not in Maschine 3, from the same files on disk.

The databases are separate (`Maschine 2/komplete.db3` and
`Maschine 3/komplete.db3`), and sample tags live in the database rather than
in the audio files, so tagging in Maschine 2 does not carry across.

## What this means for the app

Nothing here changes the layout rules, which were confirmed correct by
Maschine 2 displaying the artwork this app installed:

- installed expansion -> `image/<product>/`, flat, `.meta` with the display
  name and no vendor
- plugin -> `image/<vendor>/<product>/`, mirroring its dist_database entry
- user sample library -> `image/<vendor>/<product>/`, no dist_database entry,
  `.meta` carrying lowercase `<vendor>` and `<name>` matching the folders

The vendor for the third case comes from the sounds (`k_sound_info.vendor`),
not from `bcvendor`, which does not follow the Properties edit.

## Dead ends, so they are not retried

- **The library Alias** (Preferences > Library > User > Alias). Does not
  change `bcvendor`.
- **Moving files between flat and nested.** Both fail while the heading is
  `Other`; both work once it is not.
- **A dist_database entry for a sample library.** No sample product on the
  machine has one - 1,086 with artwork, zero with an entry.
- **Reading `Maschine 2/komplete.db3`.** It still exists, is larger, and has
  more bank chains than the live Maschine 3 one, so it looks like the right
  file while being an abandoned install. Picking the most recently written
  fails too: opening Maschine 2 for one test makes it the newest. The app and
  scripts now read `Maschine 3/komplete.db3` by name; `scripts/find-db.sh`
  still lists them all.
- **Copying `komplete.db3` without its `-wal`.** SQLite holds recent writes
  in the sidecar until Maschine checkpoints on quit, so a copy of the `.db3`
  alone can be days stale while looking current.

## Open question

What writes `k_bank_chain.bcvendor` for user content in Maschine 3, if
anything does. Until that is answered, a user sample library tagged in
Maschine 3 cannot display artwork there, however it is laid out on disk.
