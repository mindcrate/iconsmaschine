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

In **Maschine 3**, the same action writes the vendor into each file's tag,
but no bank. `bcvendor` stays `Other`, and the artwork never appears.

Confirmed both ways on the same libraries: 808 COLLECTION and Voodoo display
correctly in Maschine 2 and not in Maschine 3, from the same files on disk.

The databases are separate (`Maschine 2/komplete.db3` and
`Maschine 3/komplete.db3`). Each version builds its bank chains on its own
scan, so a heading set in Maschine 2 does not carry across.

## What this means for the app

Nothing here changes the layout rules, which were confirmed correct by
Maschine 2 displaying the artwork this app installed:

- installed expansion -> `image/<product>/`, flat, `.meta` with the display
  name and no vendor
- plugin -> `image/<vendor>/<product>/`, mirroring its dist_database entry
- user sample library -> `image/<vendor>/<product>/`, no dist_database entry,
  `.meta` carrying lowercase `<vendor>` and `<name>` matching the folders

The vendor for the third case comes from the sounds (`k_sound_info.vendor`),
not from `bcvendor`, which does not follow the Properties edit. For that
library to display in Maschine 3, its files also need a bank chain in their
tag (see below).

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

## What sets the heading in Maschine 3

The bank chain comes from a tag inside each WAV file. Maschine 3 reads it when
it scans the folder.

NI stores the tag in an `ID3 ` RIFF chunk (ID3v2.4), as a GEOB frame with the
description `com.native-instruments.nks.soundinfo`. The frame holds a msgpack
map with keys such as `vendor`, `bankchain`, `name`, `author`, `types` and
`tempo`.

- A file whose tag has a `vendor` and a non-empty `bankchain` gets a real
  chain: `virtualBC = 0`, `bcvendor = <vendor>`, `entry1..3` from the bank
  list.
- A file with no `bankchain` gets a chain built from its folder path:
  `virtualBC = 1` and `bcvendor = 'Other'`, whatever the vendor says. Every
  `Other` chain in the database is one of these.

Tested on Maschine 3 with six copies of 808 COLLECTION samples. The audio was
unchanged; only the tag was rewritten to `vendor "tim moose"`,
`bankchain ["808 COLLECTION", ...]`. After a rescan of the user folder all six
had `virtualBC = 0` and `bcvendor = 'tim moose'`. The browser showed a new
`tim moose` heading with an `808 COLLECTION` tile that carried the artwork
from `image/tim moose/808 collection/`.

The msgpack frame alone is enough. Files that also had the bank list in the
older `com.native-instruments.nisound.soundinfo` frame gave the same result.

So for a user sample library, the app must write `vendor` and `bankchain`
into each WAV's `nks.soundinfo` frame, then have Maschine 3 rescan the folder.
No database write is needed.
