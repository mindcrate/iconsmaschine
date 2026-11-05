# Iconmaschine

A local web app that builds the custom browser images Native Instruments Maschine
uses for third-party sample kits, plugins and Kontakt libraries — then installs
them straight into `NI Resources` on this machine.

Rebuild of the original Drupal app, minus the accounts, payments and upload
round-trip. It runs on your own machine and writes to your own disk.

## Run it

Needs **Node 22 or newer** (`node -v` to check; `brew install node` if not).

```bash
npm install
cp .env.example .env.local     # optional, only needed for AI artwork
npm run dev
```

Then open <http://localhost:4321>.

Port already taken? `PORT=4322 npm run dev`. To free the default instead:

```bash
lsof -ti tcp:4321 | xargs kill
```

## What it does

1. **Pick a kit type** — Sample Kit, Kontakt Instrument, Plugin, or Maschine Group.
   This decides the folder shape.
2. **Name the folder** — must match exactly what Maschine shows. The app rejects
   the special characters NI disallows and previews the resulting path.
3. **Add artwork** — upload an image or generate one with the OpenAI image API.
   Optionally use a second image for the logo files.
4. **Build** — every file is rendered at its exact spec size. Artwork files are
   cropped to fill; logo files are fitted whole so nothing is cut off.
5. **Install** — shows exactly which files will be written and what they would
   overwrite, then writes them. Or download a `.zip` laid out the same way.

Packs are saved to `~/.iconmaschine/packs` so you can reopen, re-render and
re-install them later.

## The files it produces

| File | Size | Where it shows |
|---|---|---|
| `MST_artwork.png` | 134 x 66 | Maschine Studio / MK3 hardware plugin browser |
| `MST_logo.png` | 240 x 196 | Maschine Studio / MK3 hardware preset browser |
| `MST_plugin.png` | 127 x 70 | Plugin chain strip on Maschine hardware |
| `VB_artwork.png` | 96 x 47 | Software visual browser tile |
| `VB_logo.png` | 227 x 47 | Software browser, after selecting the plugin in the filter list |
| `OSO_logo.png` | 417 x 65 | Wide logo lockup in the NI browser chrome |
| `NKS2_hardware_banner.webp` | 1280 x 212 | NKS2 banner on MK3 / S-series MK3 |
| `NKS2_hardware_banner_1280x152.webp` | 1280 x 152 | Shorter NKS2 banner variant |
| `<Folder>.meta` | — | Sits beside the folder, named to match it exactly |

These are **calibrated against 626 real NI libraries**, not copied from
documentation. The calibration corrected four sizes the published community
docs had wrong — `MST_logo` (was listed as 240x96), `MST_plugin` (190x75),
`OSO_logo` (417x64), and `VB_logo`, whose size no public source gave at all.

## Calibrate

The **Calibrate** panel reads the NI libraries already installed on this machine
and reports the sizes they actually use, so the built-in spec can be checked
against reality rather than against a forum post. It also copies a real `.meta`
file to use as the template for your packs.

Run it once before your first install.

The plugin category list is also read from your installed `dist_database`
entries, so the options offered are the exact strings Maschine already accepts
rather than a guess.

The table shows every distinct size found per file, with how many libraries use
each, so a split distribution is visible rather than averaged away. If anything
disagrees with the built-in spec, your libraries are the ground truth: update
`src/lib/spec.ts` to match.

## Where things go

Maschine needs **two** folders per product, not one. Images alone resolve to
nothing.

```
/Users/Shared/NI Resources/
  image/<vendor>/<product>/             <- PLUGINS nest by vendor
  image/<product>/                      <- EXPANSIONS sit flat
      MST_*.png  VB_*.png  OSO_logo.png  NKS2_*.webp
      <product>.meta                    XML: name + type "image"

  dist_database/<vendor>/<product>/     <- plugins only
      categories.json                   vendor, product, file type, categories
      color.json                        { "VB_bgcolor" : "f4b021" }
      shortname.json                    one short name per hardware generation
      <product>.meta                    XML: vendor + name + type "dist_database"
```

Nesting is not uniform, and both shapes exist on a real system:
`image/futureaudioworkshop/sublab/` for the SubLab plugin, `image/amplified funk/`
for the Amplified Funk expansion. A plugin's image path mirrors its
dist_database path.

Folder names are **lowercased**, matching how NI stores them (`amplified funk`,
`futureaudioworkshop/sublab`). The properly cased name goes inside the `.meta`
and JSON files.

The two `.meta` files are not interchangeable — `<type>` names the tree the file
sits in, and only the dist_database one carries `<vendor>`. Both are generated
from scratch.

On Windows the root is `C:\Users\Public\Documents\NI Resources` — set
`NI_RESOURCES_IMAGE_DIR` to the `image` folder under it.

**Restart Maschine fully after installing.** A browser rescan often does not
pick these up.

### Which types get which

| Kit type | image/ | dist_database/ |
|---|---|---|
| Plugin (effect or instrument) | `<vendor>/<product>/` | `<vendor>/<product>/` |
| Sample Kit / Expansion | `<product>/` | — |
| Kontakt Instrument | `<product>/` | — |
| Maschine Group | `<product>/` | — |

That mirrors the installed set: 7 plugin vendors in `dist_database` against 547
folders in `image`.

### The vendor string has to match exactly

In Maschine's plugin browser, the heading above your plugin is the vendor it
will match on. Use that verbatim — `Xfer Records`, not `Xfer`; `iZotope Inc`,
not `iZotope`. A near-miss installs cleanly and shows no artwork at all.

Got it wrong? **Remove from NI Resources** on the pack deletes only the files
this app wrote, then rebuild with the corrected name.

### Artwork still needs a matching Vendor

For anything without a dist_database entry, the images resolve by the **Vendor
property on the content**, not by folder name. NI-approved Kontakt libraries and
plugins carry one already. A user sample kit does not, so its artwork will not
appear until the content is tagged — in Maschine's browser, select it, then
Edit → properties. See `docs/nks-image-spec.md`.

## Configuration

All optional — see `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | Enables the "Generate with AI" tab. Server-side only. |
| `NI_RESOURCES_IMAGE_DIR` | `/Users/Shared/NI Resources/image` | Artwork install target |
| `NI_RESOURCES_DIST_DB_DIR` | *(sibling of the above)* | Plugin metadata target |
| `ICONMASCHINE_HOME` | `~/.iconmaschine` | Saved packs and the `.meta` template |

## Known limits

- Maschine only reads custom images for **NI-approved** Kontakt Player
  libraries. Unofficial libraries and user Sounds will not pick them up.
- Stock Maschine does not read custom images for user **Groups**. That kit type
  builds the pack anyway so it is ready if that changes.
- **Sample tagging is not built yet.** This app handles images and folders. Writing
  Bank / Type / Sub-Type / Character tags into samples so they filter correctly
  in the Maschine browser is a separate job — see the roadmap note in
  `docs/nks-image-spec.md`.

## Tests

```bash
npm test        # renders, zip output, install paths, traversal safety
npm run build   # production build
```
