/**
 * The NI Resources image spec.
 *
 * These sizes are calibrated against 626 Native Instruments libraries installed
 * on a real machine, not taken from documentation. That calibration corrected
 * four values the published community docs had wrong:
 *
 *   MST_logo.png    240x96  -> 240x196   (626 libraries)
 *   MST_plugin.png  190x75  -> 127x70    (69 libraries)
 *   VB_logo.png     unknown -> 227x47    (625 libraries)
 *   OSO_logo.png    417x64  -> 417x65    (609 libraries)
 *
 * MST_plugin.png appears in far fewer libraries than the rest, since only
 * plugin vendors ship it - 69 is the plugin subset, not a weak signal.
 *
 * Re-run the calibrator (src/lib/calibrate.ts) on any machine to re-check these
 * against the libraries installed there.
 */

export type Fit = "cover" | "contain";

export interface ImageSpec {
  /** Filename written into the pack folder. */
  file: string;
  width: number;
  height: number;
  format: "png" | "webp";
  /** `cover` crops to fill (artwork), `contain` letterboxes (logos). */
  fit: Fit;
  /** Which source image drives this file by default. */
  source: "artwork" | "logo";
  /** Shown in the UI so you know what each file actually affects. */
  description: string;
  /** True when the dimensions are a best guess rather than calibrated. */
  unverified?: boolean;
  /** Not written unless the pack opts into NKS2. */
  nks2?: boolean;
}

export const IMAGE_SPECS: ImageSpec[] = [
  {
    file: "MST_artwork.png",
    width: 134,
    height: 66,
    format: "png",
    fit: "cover",
    source: "artwork",
    description: "Artwork on the Maschine Studio / MK3 hardware plugin browser.",
  },
  {
    file: "MST_logo.png",
    width: 240,
    height: 196,
    format: "png",
    fit: "contain",
    source: "logo",
    description: "Logo on the Maschine Studio / MK3 hardware preset browser.",
  },
  {
    file: "MST_plugin.png",
    width: 127,
    height: 70,
    format: "png",
    fit: "contain",
    source: "logo",
    description: "Shown in the plugin chain strip on Maschine hardware.",
  },
  {
    file: "VB_artwork.png",
    width: 96,
    height: 47,
    format: "png",
    fit: "cover",
    source: "artwork",
    description: "Tile in the Maschine software visual browser.",
  },
  {
    file: "VB_logo.png",
    width: 227,
    height: 47,
    format: "png",
    fit: "contain",
    source: "logo",
    description:
      "Software browser, after selecting the plugin in the filter list.",
  },
  {
    file: "OSO_logo.png",
    width: 417,
    height: 65,
    format: "png",
    fit: "contain",
    source: "logo",
    description: "Wide logo lockup used by the NI browser chrome.",
  },
  {
    file: "NKS2_hardware_banner.webp",
    width: 1280,
    height: 212,
    format: "webp",
    fit: "cover",
    source: "artwork",
    description: "NKS2 banner on MK3 / S-series MK3 displays.",
    nks2: true,
  },
  {
    file: "NKS2_hardware_banner_1280x152.webp",
    width: 1280,
    height: 152,
    format: "webp",
    fit: "cover",
    source: "artwork",
    description: "Shorter NKS2 banner variant shipped by some NI libraries.",
    nks2: true,
  },
];

export type KitType = "sample_kit" | "kontakt" | "plugin" | "group";

export interface KitTypeInfo {
  id: KitType;
  label: string;
  blurb: string;
  /** Plugin packs nest a subfolder under the vendor folder. */
  usesSubfolder: boolean;
  nameHint: string;
}

export const KIT_TYPES: KitTypeInfo[] = [
  {
    id: "sample_kit",
    label: "Sample Kit",
    blurb:
      "A third-party Maschine sample kit or expansion, as it appears in the browser.",
    usesSubfolder: false,
    nameHint: "Blap Kit",
  },
  {
    id: "kontakt",
    label: "Kontakt Instrument",
    blurb:
      "A Kontakt Player library. Must match the library name exactly. Unofficial (non-NI-approved) libraries are not supported by Maschine.",
    usesSubfolder: false,
    nameHint: "Exhale",
  },
  {
    id: "plugin",
    label: "Plugin (Effect or Instrument)",
    blurb:
      "A VST/AU vendor. Add a subfolder per plugin when one vendor ships several (e.g. Sugar Bytes > Looperator).",
    usesSubfolder: true,
    nameHint: "LennarDigital",
  },
  {
    id: "group",
    label: "Maschine Group",
    blurb:
      "Artwork for your own saved Groups. Not supported by stock Maschine 2.4 - included so packs are ready if you keep Groups in a vendor-style folder.",
    usesSubfolder: false,
    nameHint: "My Drum Groups",
  },
];

export function specsFor(opts: { nks2: boolean }): ImageSpec[] {
  return IMAGE_SPECS.filter((s) => opts.nks2 || !s.nks2);
}

/**
 * Folder names must match what Maschine shows, and NI's own guidance rules out
 * the punctuation that breaks their browser index.
 */
const FORBIDDEN = /[$%&@#!_\\/:*?"<>|]/;

export function validateFolderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a folder name.";
  if (trimmed !== name) return "Remove the leading/trailing spaces.";
  if (FORBIDDEN.test(name))
    return `Special characters are not allowed ($ % & @ # ! _ and path separators).`;
  if (name.startsWith(".")) return "Folder name cannot start with a dot.";
  if (name.length > 64) return "Keep the name under 64 characters.";
  return null;
}
