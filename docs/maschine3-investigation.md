# Handoff: how does Maschine 3 decide a user library's vendor heading?

A prompt and the context for a session running locally on the Mac, with the
Maschine 3 application bundle and databases present. The cloud session that
wrote this has neither.

Read `docs/vendor-heading.md` first. It has the measurements this rests on.

---

## The question

In Maschine 3, `k_bank_chain.bcvendor` decides the browser heading a library
appears under, and artwork only resolves when that heading is not `Other`.
For a library of plain audio files added through Preferences > Library >
User, it is always `Other`, and nothing exposed in the UI changes it.

**What sets `bcvendor`, and can a user sample library be made to get a real
vendor heading in Maschine 3?**

## What is already ruled out

Each of these was tested on the machine, not assumed:

- Setting Vendor on the sounds (Edit > Properties > Vendor > Apply). Writes
  `k_sound_info.vendor` for every selected sound and leaves `bcvendor` as
  `Other`. The same action in Maschine 2 writes `bcvendor` and the artwork
  appears, from identical files on disk.
- The library Alias in Preferences > Library > User.
- Right-clicking the library or bank in the browser sidebar.
- Moving artwork between `image/<product>/` and `image/<vendor>/<product>/`.
  Both fail while the heading is `Other`; both work once it is not.
- A `dist_database` entry. No sample product on the machine has one.

## The leading hypothesis

Maschine 3 derives the heading from metadata carried by the content or its
product registration, rather than from anything the user types.

Supporting it: every heading Maschine 3 does fill in belongs to a plugin or
an NKS library, which carry vendor metadata of their own - Arturia (59
chains), Sugar Bytes (49), iZotope (23), Applied Acoustics Systems (8),
FutureAudioWorkshop (7), Softube (4), Xfer Records, Sonic Charge. Every one
of the 735 chains under `Other` is a plain folder of audio with no such
metadata. NI's own expansions sit under a BLANK heading, which the browser
renders as "Native Instruments", and are registered products.

If that holds, the route is to register the folder as a product rather than
to find a field to set - the same shape NI expansions and NKS libraries use
(`.nicnt` content registration, a product entry under
`/Library/Application Support/Native Instruments/<Product>/`, and whatever
Native Access writes). Confirm or kill this before anything else.

## Where to look

- `~/Library/Application Support/Native Instruments/Maschine 3/komplete.db3`
  - the live browser database. Copy it WITH its `-wal` and `-shm` sidecars
    before reading; Maschine holds recent writes there until it quits, so a
    copy of the `.db3` alone can be days stale while looking current.
  - `k_bank_chain` (`bcvendor`, `entry1..3`), `k_sound_info`
    (`vendor`, `device_type_flags`, `content_path_id`), `k_content_path`.
  - Worth dumping the full schema: it differs from Maschine 2's, and the
    difference may itself be the answer.
- `/Library/Application Support/Native Instruments/Maschine 3/PAResources/`
  - `_DatabaseResources/color/color.db`, `_DatabaseResources/shortname/shortname.db`,
    `database/PAL/categories.db`. Product-level metadata, read-only, worth
    understanding since they are keyed by something.
- `/Users/Shared/NI Resources/` - `image/` and `dist_database/`.
- The Maschine 3 bundle itself. Strings and symbols around `bcvendor`,
  `bank_chain`, `vendor`, `nicnt` would say what writes the field. This is
  interoperability work on software the user owns, to make their own artwork
  display in a product they paid for.

## How to work

- **Read-only on `komplete.db3` unless the user explicitly says otherwise.**
  It holds their entire library index. Open a copy. If a write experiment is
  worth running, back the file up first, do it with Maschine closed, and
  expect a rescan to undo it - the point of such a test is to learn whether
  the field alone is sufficient, not to ship it as the fix.
- Prefer a test that changes something and observes the browser over reading
  code and reasoning about it. The whole history of this problem is plausible
  reasoning that turned out to be checking the wrong variable - a two-day-old
  database, an abandoned Maschine 2 install, folder names that never mattered.
- Say which database each reading came from. Both exist, the wrong one is
  larger and has more rows, and its output looks entirely reasonable.

## What a good answer looks like

One of:

1. A reproducible way to give a user sample library a real vendor heading in
   Maschine 3, with the artwork appearing. Then say what the app must write,
   and `src/lib/install.ts` can do it.
2. Evidence that Maschine 3 cannot do this for plain audio folders at all.
   Then the app should say so plainly when a kit's heading is `Other`,
   rather than installing files that will never be read.

Either is worth having. The second is not a failure.

## Useful from this repo

All read-only, all take `MASCHINE_DB_PATH` to point elsewhere:

- `scripts/find-db.sh [name]` - every NI database, newest first, which holds
  a given library, and the artwork trees.
- `scripts/trace-kit.sh "<library>"` - one library's heading, the vendor on
  its sounds, content types, where its audio lives, and every candidate
  image folder with its files and `.meta`.
- `scripts/vendors.sh` - every bank chain grouped by heading, with artwork
  found flat, nested or not at all, split by installed versus the user's own.
- `scripts/inspect-nksf.sh` - the NKS preset container, which carries a
  vendor field in its NISI chunk. `src/lib/nksf.ts` parses and rewrites it
  byte-exactly; that is the one place vendor metadata is known to live
  inside content, so it may be the model for what a sample library needs.
