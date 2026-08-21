# NI Resources image spec (working notes)

Install root (Mac): `/Users/Shared/NI Resources/image/<FOLDER_NAME>/`
Install root (Win): `C:\Users\Public\Documents\NI Resources\image\<FOLDER_NAME>\`

`<FOLDER_NAME>` must match EXACTLY the third-party Sample Kit / Kontakt library /
plugin vendor name as Maschine shows it. No special characters.

## Files

| File | Size (px) | Where it shows |
|---|---|---|
| `MST_artwork.png` | 134 x 66 | Maschine Studio / MK3 hardware plugin browser |
| `MST_logo.png` | 240 x 96 | Maschine Studio / MK3 hardware preset browser |
| `MST_plugin.png` | 190 x 75 | Maschine hardware plugin-chain strip |
| `VB_artwork.png` | 96 x 47 | Software visual browser tile |
| `VB_logo.png` | TBD - confirm | Software browser, after selecting plugin in filter list |
| `OSO_logo.png` | 417 x 64 | (NI-internal / "one screen" logo) |
| `NKS2_hardware_banner.webp` | 1280 x 212 @72dpi | NKS2 hardware banner (MK3 / S-series MK3) |
| `NKS2_hardware_banner_1280x152.webp` | 1280 x 152 | alternate NKS2 banner variant seen on some libs |
| `<FOLDER_NAME>.meta` | - | filename must match the vendor/library name exactly; contents not normally edited |

## Open items
- `VB_logo.png` exact dimensions - verify against an installed NI library.
- `.meta` byte-for-byte contents - verify against an installed NI library.
- Whether `color.json` is needed (referenced for background colour behind transparent VB_logo).

## Sources
- PresetMagician NKS details, resoundlabs Maschine custom graphics, maschinetutorials.com,
  NI Community NKS2 threads. Ground truth to be confirmed by reading a real installed
  NI library folder on the target Mac.
