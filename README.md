# Iconmaschine

A local web app that builds the custom browser images Native Instruments Maschine
uses for third-party sample kits, plugins and Kontakt libraries — then installs
them straight into `NI Resources` on this machine.

Rebuild of the original Drupal app, minus the accounts, payments and upload
round-trip. It runs on your own machine and writes to your own disk.

## Run it

```bash
npm install
cp .env.example .env.local     # optional, only needed for AI artwork
npm run dev
```

Then open <http://localhost:4321>.

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
| `MST_logo.png` | 240 x 96 | Maschine Studio / MK3 hardware preset browser |
| `MST_plugin.png` | 190 x 75 | Plugin chain strip on Maschine hardware |
| `VB_artwork.png` | 96 x 47 | Software visual browser tile |
| `VB_logo.png` | 240 x 96 † | Software browser, after selecting the plugin in the filter list |
| `OSO_logo.png` | 417 x 64 | Wide logo lockup in the NI browser chrome |
| `NKS2_hardware_banner.webp` | 1280 x 212 | NKS2 banner on MK3 / S-series MK3 |
| `NKS2_hardware_banner_1280x152.webp` | 1280 x 152 | Shorter NKS2 banner variant |
| `<Folder>.meta` | — | Sits beside the folder, named to match it exactly |

† **Not verified.** `VB_logo.png`'s dimensions are the one thing not documented
in any public source, so this is a best guess and the UI flags it. Use
**Calibrate** (below) to replace it with the real value.

## Calibrate

The **Calibrate** panel reads the NI libraries already installed on this machine
and reports the sizes they actually use, so the built-in spec can be checked
against reality rather than against a forum post. It also copies a real `.meta`
file to use as the template for your packs.

Run it once before your first install. Without a harvested template, the `.meta`
is written empty — which the manual tutorials say works, but a real one is
better. If Calibrate reports a size that differs from the table above, the real
library wins: update `src/lib/spec.ts`.

## Where things go

Installs to `/Users/Shared/NI Resources/image/<Folder>/` on macOS. On Windows
the equivalent is `C:\Users\Public\Documents\NI Resources\image\<Folder>\` — set
`NI_RESOURCES_IMAGE_DIR` to point there.

Plugin packs with a subfolder nest one level, with the `.meta` at the vendor
level:

```
NI Resources/image/
  Sugar Bytes/
    Sugar Bytes.meta
    Looperator/
      MST_artwork.png
      ...
```

Restart Maschine after installing for the browser to pick the images up.

## Configuration

All optional — see `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | Enables the "Generate with AI" tab. Server-side only. |
| `NI_RESOURCES_IMAGE_DIR` | `/Users/Shared/NI Resources/image` | Install target |
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
