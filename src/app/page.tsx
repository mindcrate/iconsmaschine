"use client";

import { useCallback, useEffect, useState } from "react";
import { ArtworkPicker, type ArtworkSource } from "@/components/ArtworkPicker";
import { CalibratePanel } from "@/components/CalibratePanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { InstallPanel } from "@/components/InstallPanel";
import { LibraryPanel } from "@/components/LibraryPanel";
import { CropEditor } from "@/components/CropEditor";
import { ReplaceImageDialog } from "@/components/ReplaceImageDialog";
import { KitPicker } from "@/components/KitPicker";
import { PresetEditor } from "@/components/PresetEditor";
import { BatchTagPanel } from "@/components/BatchTagPanel";
import { SampleTagsPanel } from "@/components/SampleTagsPanel";
import { OverlayControls } from "@/components/OverlayControls";
import { StepDrawer } from "@/components/StepDrawer";
import { StepPanel } from "@/components/StepPanel";
import {
  STEPS,
  blockers,
  fallbackStep,
  isStep,
  nextStep,
  prevStep,
  stepViews,
  toolsFor,
  type PackFacts,
  type StepId,
  type ViewId,
} from "@/lib/steps";
import { DEFAULT_OVERLAY, type TextOverlay } from "@/lib/overlayspec";
import { specsFor } from "@/lib/spec";

/**
 * How a display name becomes a folder name on disk. Mirrors folderName() in
 * lib/distdb, which is not imported here because its module pulls in Buffer
 * via the .meta writer and this is a client component.
 */
const folderish = (display: string) => display.trim().toLowerCase();
import { PreviewGrid } from "@/components/PreviewGrid";
import type { Crop, CropMap } from "@/lib/crop";
import { getJson, sendForm } from "@/lib/client";
import {
  KIT_TYPES,
  LOGO_SOURCED_FILES as SPEC_LOGO_FILES,
  validateFolderName,
  type KitType,
} from "@/lib/spec";
import type { AppStatus, Pack, PreviewFile, Vocabulary } from "@/lib/types";

export default function Page() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);

  const [kitType, setKitType] = useState<KitType>("sample_kit");
  /** False for a new pack until a kit card is clicked, so only step 1 is open. */
  const [kitChosen, setKitChosen] = useState(false);
  const [view, setView] = useState<ViewId>("kit");
  /** Tools and pages opened so far. They stay mounted, hidden, so their own state survives. */
  const [visited, setVisited] = useState<Set<ViewId>>(() => new Set(["kit"]));
  const [vendor, setVendor] = useState("");
  const [product, setProduct] = useState("");
  const [fileType, setFileType] = useState("Instruments");
  const [categories, setCategories] = useState<string[]>([]);
  const [shortName, setShortName] = useState("");
  const [bgColor, setBgColor] = useState("#f4b021");
  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [name, setName] = useState("");
  const [author, setAuthor] = useState("");
  const [share, setShare] = useState(false);
  // Nest image/ under the vendor. True for a sample pack the user added, which
  // is laid out image/<vendor>/<product>/; false for an installed expansion,
  // which sits flat. Set from the kit picker, overridable here.
  const [nestImage, setNestImage] = useState(false);
  const [rulesVersion, setRulesVersion] = useState(0);
  const [tags, setTags] = useState("");
  const [nks2, setNks2] = useState(true);
  const [background, setBackground] = useState("#101010");
  const [transparent, setTransparent] = useState(true);
  const [padding, setPadding] = useState(0.08);
  // Text burned into the logo and banner files. Empty text means no overlay,
  // so this can be held as a plain value rather than a nullable one.
  const [overlay, setOverlay] = useState<TextOverlay>(DEFAULT_OVERLAY);

  const [artwork, setArtwork] = useState<ArtworkSource | null>(null);
  const [logo, setLogo] = useState<ArtworkSource | null>(null);
  const [useSeparateLogo, setUseSeparateLogo] = useState(false);

  const [packId, setPackId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewFile[] | null>(null);
  const [crops, setCrops] = useState<CropMap>({});
  const [editing, setEditing] = useState<PreviewFile | null>(null);
  const [fileSources, setFileSources] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState<PreviewFile | null>(null);
  /** Bumped after a replace so image URLs that did not change their path still reload. */
  const [sourceVersion, setSourceVersion] = useState(0);
  // Bumped when NI Resources changes, so the kit list re-reads.
  const [kitsToken, setKitsToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kitInfo = KIT_TYPES.find((k) => k.id === kitType)!;
  // A nested user sample pack keeps its vendor too: it names the image folder
  // and is what install writes into the library's WAV tags.
  const savedVendor = kitInfo.usesDistDb || nestImage ? vendor : "";
  const productError = product ? validateFolderName(product) : null;
  const vendorError =
    kitInfo.usesDistDb && vendor ? validateFolderName(vendor) : null;
  const needsVendor = kitInfo.usesDistDb && !vendor.trim();
  const needsCategory = kitInfo.usesDistDb && categories.length === 0;
  const canBuild =
    Boolean(artwork) &&
    Boolean(product) &&
    !productError &&
    !vendorError &&
    !needsVendor &&
    !needsCategory;

  const facts: PackFacts = {
    kitType,
    kitChosen,
    nameValid: Boolean(product) && !productError && !vendorError && !needsVendor,
    browserValid: !needsCategory,
    hasArtwork: Boolean(artwork),
    built: Boolean(preview && packId),
    nestedSampleKit: kitType === "sample_kit" && nestImage && Boolean(vendor.trim()),
    installed: Boolean(packs.find((p) => p.id === packId)?.installedAs),
  };
  const views = stepViews(facts);
  const tools = kitChosen ? toolsFor(kitType) : [];
  const labels = Object.fromEntries(STEPS.map((s) => [s.id, s.label])) as Record<StepId, string>;
  const stepView = (id: StepId) => views.find((v) => v.id === id);
  const panel = (id: StepId) => ({
    view: stepView(id),
    current: view,
    labels,
    needs: blockers(views, id),
    onGo: (to: StepId) => go(to),
  });

  function go(to: ViewId) {
    setView(to);
    setVisited((prev) => (prev.has(to) ? prev : new Set(prev).add(to)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // A kit type or nesting change can hide the current step or tool. Move to
  // the nearest open step before it rather than leave a blank page.
  const shownIds = views.map((v) => v.id).join(",") + "|" + tools.map((t) => t.id).join(",");
  useEffect(() => {
    if (isStep(view)) {
      if (!views.some((v) => v.id === view)) setView(fallbackStep(views, view));
    } else if ((view === "presets" || view === "batch") && !tools.some((t) => t.id === view)) {
      setView(fallbackStep(views, "install"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownIds, view]);

  const categoryOptions = vocab?.byFileType[fileType] ?? [];
  const fileTypeOptions = vocab ? Object.keys(vocab.byFileType) : ["Instruments", "Effects"];

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getJson<AppStatus>("/api/status"));
    } catch {
      /* status is advisory only */
    }
  }, []);

  const refreshPacks = useCallback(async () => {
    try {
      const { packs } = await getJson<{ packs: Pack[] }>("/api/packs");
      setPacks(packs);
    } catch {
      /* library is advisory only */
    }
  }, []);

  const refreshVocab = useCallback(async () => {
    try {
      setVocab(await getJson<Vocabulary>("/api/vocab"));
    } catch {
      /* falls back to the built-in list */
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void refreshPacks();
    void refreshVocab();
  }, [refreshStatus, refreshPacks, refreshVocab]);

  function resetOutputs() {
    setPreview(null);
    setPackId(null);
    setFileSources({});
  }

  /** Clears every field so a new instrument can be started from scratch. */
  function clearForm() {
    if (
      (product || vendor || artwork) &&
      !confirm("Clear all fields and start a new pack?\n\nSaved packs are not affected - this only empties the form.")
    )
      return;
    setVendor("");
    setProduct("");
    setFileType("Instruments");
    setCategories([]);
    setShortName("");
    setBgColor("#f4b021");
    setName("");
    setAuthor("");
    setShare(false);
    setTags("");
    setNks2(true);
    setBackground("#101010");
    setTransparent(true);
    setPadding(0.08);
    setOverlay(DEFAULT_OVERLAY);
    setArtwork(null);
    setLogo(null);
    setUseSeparateLogo(false);
    setCrops({});
    setFileSources({});
    setEditing(null);
    setError(null);
    resetOutputs();
    setKitChosen(false);
    void refreshVocab();
    void refreshStatus();
    go("kit");
  }

  /** Brings step C and the preview in line with the pack the server just saved. */
  async function applySavedPack(pack: Pack) {
    setCrops(pack.crops ?? {});
    setFileSources(pack.fileSources ?? {});
    setSourceVersion((v) => v + 1);
    const v = Date.now();
    setArtwork({ preview: `/api/packs/${pack.id}/source?which=artwork&v=${v}`, blob: new Blob(), origin: "upload" });
    // A logo-group replace creates the logo. The next build must keep it, so
    // step C's logo box and image follow the pack.
    setUseSeparateLogo(pack.hasLogo);
    setLogo(pack.hasLogo ? { preview: `/api/packs/${pack.id}/source?which=logo&v=${v}`, blob: new Blob(), origin: "upload" } : null);
    const { files } = await getJson<{ files: PreviewFile[] }>(`/api/packs/${pack.id}/preview`);
    setPreview(files);
    void refreshPacks();
  }

  /** Persist a crop and re-render just by rebuilding the pack. */
  async function saveCrop(file: string, crop: Crop | null) {
    const next: CropMap = { ...crops };
    if (crop) next[file] = crop;
    else delete next[file];
    setCrops(next);
    setEditing(null);
    if (!packId) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("kitType", kitType);
      form.set("vendor", savedVendor);
      form.set("product", product);
      form.set("fileType", fileType);
      form.set("categories", categories.join(","));
      form.set("shortName", shortName);
      form.set("bgColor", bgColor);
      form.set("name", name);
      form.set("author", author);
      form.set("share", String(share));
      form.set("nestImage", String(nestImage));
      form.set("overlay", JSON.stringify(overlay));
      form.set("tags", tags);
      form.set("nks2", String(nks2));
      form.set("background", transparent ? "" : background);
      form.set("padding", String(padding));
      form.set("crops", JSON.stringify(next));
      await sendForm<{ pack: Pack }>(`/api/packs/${packId}`, form, "PUT");
      const { files } = await getJson<{ files: PreviewFile[] }>(
        `/api/packs/${packId}/preview`,
      );
      setPreview(files);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function build() {
    if (!artwork) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("kitType", kitType);
      form.set("vendor", savedVendor);
      form.set("product", product);
      form.set("fileType", fileType);
      form.set("categories", categories.join(","));
      form.set("shortName", shortName);
      form.set("bgColor", bgColor);
      form.set("name", name);
      form.set("author", author);
      form.set("share", String(share));
      form.set("nestImage", String(nestImage));
      form.set("overlay", JSON.stringify(overlay));
      form.set("tags", tags);
      form.set("crops", JSON.stringify(crops));
      form.set("nks2", String(nks2));
      form.set("background", transparent ? "" : background);
      form.set("padding", String(padding));
      form.set("artwork", artwork.blob, "artwork.png");
      if (useSeparateLogo && logo) {
        form.set("logo", logo.blob, "logo.png");
      } else {
        form.set("clearLogo", "true");
      }

      const { pack } = packId
        ? await sendForm<{ pack: Pack }>(`/api/packs/${packId}`, form, "PUT")
        : await sendForm<{ pack: Pack }>("/api/packs", form);

      setPackId(pack.id);
      const { files } = await getJson<{ files: PreviewFile[] }>(
        `/api/packs/${pack.id}/preview`,
      );
      setPreview(files);
      void refreshPacks();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openPack(pack: Pack) {
    setKitChosen(true);
    setKitType(pack.kitType);
    setVendor(pack.vendor);
    setProduct(pack.product);
    setFileType(pack.fileType);
    setCategories(pack.categories);
    setShortName(pack.shortName ?? "");
    setBgColor(`#${pack.bgColor}`);
    setName(pack.name);
    setAuthor(pack.author);
    setShare(pack.share);
    setNestImage(Boolean(pack.nestImage));
    setTags(pack.tags.join(", "));
    setNks2(pack.nks2);
    setTransparent(pack.background === null);
    if (pack.background) setBackground(pack.background);
    setPadding(pack.padding);
    setOverlay(pack.overlay ?? DEFAULT_OVERLAY);
    setPackId(pack.id);
    setCrops(pack.crops ?? {});
    setFileSources(pack.fileSources ?? {});
    setPreview(null);
    setError(null);
    setUseSeparateLogo(pack.hasLogo);
    setArtwork({
      preview: `/api/packs/${pack.id}/source?which=artwork`,
      blob: new Blob(),
      origin: "upload",
    });
    setLogo(
      pack.hasLogo
        ? {
            preview: `/api/packs/${pack.id}/source?which=logo`,
            blob: new Blob(),
            origin: "upload",
          }
        : null,
    );
    // A saved pack's images are already built, so open it ready to review or
    // install rather than make Tim build again before anything unlocks.
    try {
      const { files } = await getJson<{ files: PreviewFile[] }>(`/api/packs/${pack.id}/preview`);
      setPreview(files);
      go(pack.installedAs ? "install" : "review");
    } catch (err) {
      setError((err as Error).message);
      go("review");
    }
  }

  async function removePack(pack: Pack) {
    if (!confirm(`Delete "${pack.name}" from your library? Installed files stay put.`))
      return;
    await fetch(`/api/packs/${pack.id}`, { method: "DELETE" });
    if (packId === pack.id) resetOutputs();
    void refreshPacks();
  }

  return (
    <>
      <div className="app">
      <StepDrawer
        views={views}
        tools={tools}
        current={view}
        onGo={go}
        onNewPack={clearForm}
        status={status}
        packCount={packs.length}
        kitLabel={kitInfo.label}
      />
      <main>
        {isStep(view) && (
          <div className="step-count">
            Step {views.findIndex((v) => v.id === view) + 1} of {views.length}
          </div>
        )}
        {error && <div className="note bad">{error}</div>}
        <StepPanel {...panel("kit")}>
        <section className="step">
          <h2>Choose your kit type</h2>
          <p className="hint">
            This decides the folder shape the pack installs into. Picking one
            also re-scans for newly installed plugins.
          </p>
          <div className="kit-grid">
            {KIT_TYPES.map((k) => (
              <button
                key={k.id}
                className="kit-card"
                aria-pressed={kitChosen && kitType === k.id}
                onClick={() => {
                  setKitType(k.id);
                  setKitChosen(true);
                  resetOutputs();
                  // Re-scan on every pick: a plugin installed since the page
                  // loaded should appear without a manual reload.
                  void refreshVocab();
                  void refreshStatus();
                }}
              >
                <strong>{k.label}</strong>
                <span>{k.blurb}</span>
              </button>
            ))}
          </div>
        </section>
        </StepPanel>

        <StepPanel {...panel("name")}>
        <section className="step">
          <h2>
            Name it
          </h2>
          <p className="hint">
            Names must match <strong>exactly</strong> what Maschine shows. Folders
            on disk are lowercased, the way NI stores them; the name you type here
            is what goes inside the .meta and JSON files. Where it lands depends
            on the kind of content: a plugin nests under its vendor in both
            trees, an installed expansion sits flat at{" "}
            <code>image/&lt;product&gt;/</code>, and a sample pack you added
            yourself nests at <code>image/&lt;vendor&gt;/&lt;product&gt;/</code>.
            Picking a kit below sets this for you.
          </p>

          {!kitInfo.usesDistDb && (
            <KitPicker
              current={product}
              reloadToken={kitsToken}
              onPick={(k) => {
                // The product is the kit's own name, always. Where its artwork
                // goes depends on k.nestUnder: a pack the user added nests at
                // image/<vendor>/<product>/, an installed expansion sits flat
                // at image/<product>/.
                //
                // This used to set the product to the VENDOR for any kit that
                // had one, which wrote image/moose life/ - a folder that on a
                // real system holds nothing but per-product subfolders. The
                // artwork landed one level above where Maschine looks.
                setProduct(k.name);
                setVendor(k.nestUnder ? k.vendor : "");
                setNestImage(Boolean(k.nestUnder));
                setName(k.name);
                resetOutputs();
              }}
            />
          )}

          <div className="row">
            {/* Always rendered for every kit type. Gating this on `nestImage`
                meant unchecking the nesting box removed the box along with the
                field, so there was no way to turn it back on. */}
            <div className="field">
                <label>
                  Vendor
                  <span className="sub">
                    {kitInfo.usesDistDb
                      ? "required for plugins"
                      : nestImage
                        ? "artwork nests under this"
                        : "optional"}
                  </span>
                </label>
                <input
                  type="text"
                  placeholder={kitInfo.vendorHint}
                  list="known-vendors"
                  value={vendor}
                  onChange={(e) => {
                    setVendor(e.target.value);
                    // Keep the open pack: rebuilding updates it, and install
                    // cleans up the old folder through installedAs.
                    setPreview(null);
                  }}
                />
                <datalist id="known-vendors">
                  {(vocab?.vendors ?? []).map((v) => (
                    <option key={v} value={v} />
                  ))}
                  {(vocab?.suggestedVendors ?? []).map((v) => (
                    <option
                      key={`s-${v}`}
                      value={v}
                      label="(Suggestion from KVR Audio)"
                    />
                  ))}
                </datalist>
                {!kitInfo.usesDistDb && (
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={nestImage}
                      onChange={(e) => {
                        setNestImage(e.target.checked);
                        setPreview(null);
                      }}
                    />
                    Nest under the vendor
                  </label>
                )}
                {vendorError && (
                  <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 5 }}>
                    {vendorError}
                  </div>
                )}
                <div style={{ color: "var(--muted)", fontSize: 11.5, marginTop: 5 }}>
                  {kitInfo.usesDistDb ? (
                    <>
                      Must match the vendor <em>exactly</em> as Maschine groups it
                      in the plugin browser - &quot;Xfer Records&quot;, not
                      &quot;Xfer&quot;. Check the group heading above your plugin.
                    </>
                  ) : nestImage ? (
                    <>
                      Artwork goes to{" "}
                      <code>
                        image/{folderish(vendor) || "<vendor>"}/
                        {folderish(product) || "<product>"}/
                      </code>
                      , and the same two names go into the .meta in lowercase.
                      This is how a library you added yourself is laid out.
                    </>
                  ) : (
                    <>
                      Artwork goes to{" "}
                      <code>image/{folderish(product) || "<product>"}/</code>.
                      Tick the box above for a library you added yourself, which
                      nests under its vendor instead.
                    </>
                  )}{" "}
                  Names marked as suggestions come from KVR Audio and are not
                  checked against Maschine.
                </div>
              </div>

            <div className="field">
              <label>
                {kitInfo.usesDistDb ? "Plugin name" : `${kitInfo.label} name`}
              </label>
              <input
                type="text"
                placeholder={kitInfo.nameHint}
                value={product}
                onChange={(e) => {
                  setProduct(e.target.value);
                  resetOutputs();
                }}
              />
              {productError && (
                <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 5 }}>
                  {productError}
                </div>
              )}
            </div>
          </div>

          {kitType === "kontakt" && (
            <div className="note">
              Maschine only supports images for NI-approved Kontakt Player
              libraries. Unofficial libraries and user Groups/Sounds will not pick
              these up.
            </div>
          )}

          {kitType === "group" && (
            <div className="note">
              Stock Maschine does not read custom images for user Groups. This
              builds the pack anyway so it is ready if that changes.
            </div>
          )}

          {!kitInfo.usesDistDb && (
            <div className="note">
              Artwork alone is not enough for this type. The content itself must
              carry a <strong>Vendor</strong> property matching this name - set it
              in Maschine&apos;s browser under Edit &rarr; properties - or nothing
              resolves to these images.
            </div>
          )}

          {product && !productError && status && (
            <div className="path-preview">
              {status.niImageDir}/
              <b>
                {kitInfo.usesDistDb && vendor && !vendorError
                  ? `${vendor.trim().toLowerCase()}/${product.trim().toLowerCase()}`
                  : product.trim().toLowerCase()}
              </b>
              /
            </div>
          )}
          {kitInfo.usesDistDb && product && vendor && !productError && !vendorError && status && (
            <div className="path-preview" style={{ marginTop: 8 }}>
              {status.niImageDir.replace(/image$/, "dist_database")}/
              <b>
                {vendor.trim().toLowerCase()}/{product.trim().toLowerCase()}
              </b>
              /
            </div>
          )}
        </section>
        </StepPanel>

        <StepPanel {...panel("browser")}>
          <section className="step">
            <h2>
              Browser entry
            </h2>
            <p className="hint">
              This is the <code>dist_database</code> half - it drives the name,
              category and colour in the browser.{" "}
              {vocab?.fromDisk
                ? `Categories below are read from the ${vocab.scanned} entries installed on this machine.`
                : "Nothing installed to read categories from yet, so this is a built-in list."}
            </p>

            <div className="row">
              <div className="field">
                <label>Type</label>
                <select
                  value={fileType}
                  onChange={(e) => {
                    setFileType(e.target.value);
                    setCategories([]);
                    resetOutputs();
                  }}
                >
                  {fileTypeOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>
                  Short name<span className="sub">for hardware displays</span>
                </label>
                <input
                  type="text"
                  placeholder={product || "SubLab"}
                  value={shortName}
                  onChange={(e) => {
                    setShortName(e.target.value);
                    resetOutputs();
                  }}
                />
              </div>
              <div className="field">
                <label>Browser colour</label>
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => {
                    setBgColor(e.target.value);
                    resetOutputs();
                  }}
                />
              </div>
            </div>

            <div className="field">
              <label>
                Categories
                <span className="sub">
                  {categories.length === 0
                    ? "pick at least one"
                    : categories.join(", ")}
                </span>
              </label>
              <div className="cat-grid">
                {categoryOptions.map((c) => (
                  <label key={c}>
                    <input
                      type="checkbox"
                      checked={categories.includes(c)}
                      onChange={(e) => {
                        setCategories((prev) =>
                          e.target.checked
                            ? [...prev, c]
                            : prev.filter((x) => x !== c),
                        );
                        resetOutputs();
                      }}
                    />
                    {c}
                  </label>
                ))}
              </div>
            </div>
          </section>
        </StepPanel>

        <StepPanel {...panel("artwork")}>
        <section className="step">
          <h2>
            Add your artwork
          </h2>
          <p className="hint">
            One image drives every file. Artwork files are cropped to fill; logo files
            are fitted whole so nothing gets cut off.
          </p>

          <ArtworkPicker
            label="Artwork"
            hint="used for the browser tiles and NKS2 banners"
            value={artwork}
            onChange={(v) => {
              setArtwork(v);
              setPreview(null);
            }}
            allowAi
            hasOpenAiKey={status?.hasOpenAiKey ?? false}
            hasSerpKey={status?.hasSerpKey ?? false}
            searchSeed={[vendor, product].filter(Boolean).join(" ")}
          />

          <div className="checkline" style={{ marginTop: 20 }}>
            <input
              id="sep-logo"
              type="checkbox"
              checked={useSeparateLogo}
              onChange={(e) => {
                setUseSeparateLogo(e.target.checked);
                setPreview(null);
              }}
            />
            <label htmlFor="sep-logo" style={{ margin: 0 }}>
              Use a different image for the logo files (MST_logo, MST_plugin, VB_logo,
              OSO_logo)
            </label>
          </div>

          {useSeparateLogo && (
            <ArtworkPicker
              label="Logo"
              hint="transparent PNG works best"
              value={logo}
              onChange={(v) => {
                setLogo(v);
                setPreview(null);
              }}
              allowAi
              hasOpenAiKey={status?.hasOpenAiKey ?? false}
              hasSerpKey={status?.hasSerpKey ?? false}
              searchSeed={[vendor, product].filter(Boolean).join(" ")}
            />
          )}

          <div className="row" style={{ marginTop: 20 }}>
            <div className="field">
              <label>Background behind logos</label>
              <div className="checkline">
                <input
                  id="transparent"
                  type="checkbox"
                  checked={transparent}
                  onChange={(e) => {
                    setTransparent(e.target.checked);
                    setPreview(null);
                  }}
                />
                <label htmlFor="transparent" style={{ margin: 0 }}>
                  Keep transparent
                </label>
              </div>
              {!transparent && (
                <input
                  type="color"
                  value={background}
                  onChange={(e) => {
                    setBackground(e.target.value);
                    setPreview(null);
                  }}
                />
              )}
            </div>

            <div className="field">
              <label>
                Logo padding
                <span className="sub">{Math.round(padding * 100)}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={0.3}
                step={0.01}
                value={padding}
                onChange={(e) => {
                  setPadding(Number(e.target.value));
                  setPreview(null);
                }}
              />
            </div>

            <div className="field">
              <label>NKS2 banners</label>
              <div className="checkline">
                <input
                  id="nks2"
                  type="checkbox"
                  checked={nks2}
                  onChange={(e) => {
                    setNks2(e.target.checked);
                    setPreview(null);
                  }}
                />
                <label htmlFor="nks2" style={{ margin: 0 }}>
                  Include the .webp banners
                </label>
              </div>
            </div>
          </div>
        </section>
        </StepPanel>

        <StepPanel {...panel("text")}>
        <OverlayControls
          value={overlay}
          onChange={(next) => {
            setOverlay(next);
            setPreview(null);
          }}
          files={specsFor({ nks2 })}
          previews={preview}
        />
        </StepPanel>

        <StepPanel {...panel("details")}>
        <section className="step">
          <h2>
            Pack details
          </h2>
          <div className="row">
            <div className="field">
              <label>
                Pack name<span className="sub">for your library here</span>
              </label>
              <input
                type="text"
                placeholder={product || "Blap Kit"}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>
                Your tags<span className="sub">comma separated</span>
              </label>
              <input
                type="text"
                placeholder="drums, trap, 2026"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </div>
            <div className="field">
              <label>
                Author<span className="sub">optional</span>
              </label>
              <input
                type="text"
                placeholder="DJ Monkey"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>
          </div>
          <div className="checkline">
            <input
              id="share"
              type="checkbox"
              checked={share}
              onChange={(e) => setShare(e.target.checked)}
            />
            <label htmlFor="share" style={{ margin: 0 }}>
              Mark this pack as shareable
            </label>
          </div>

        </section>

        </StepPanel>

        <StepPanel {...panel("review")}>
          <section className="step">
            <h2>Review and build</h2>
            <p className="hint">
              {preview && packId
                ? `${preview.length} files ready. Click a file to adjust its crop or replace its image, then go on to install.`
                : "Build the images from the steps so far. Nothing is written to NI Resources yet."}
            </p>
          <div className="actions">
            <button className="btn" onClick={build} disabled={!canBuild || busy}>
              {busy ? <><span className="spinner" /> Building…</> : preview && packId ? "Rebuild the images" : "Build the images"}
            </button>
            {!artwork && (
              <span style={{ color: "var(--muted)", fontSize: 12 }}>
                Add artwork in the Artwork step first.
              </span>
            )}
            {artwork && needsVendor && (
              <span style={{ color: "var(--muted)", fontSize: 12 }}>
                A plugin needs a vendor name.
              </span>
            )}
            {artwork && !needsVendor && needsCategory && (
              <span style={{ color: "var(--muted)", fontSize: 12 }}>
                Pick at least one category.
              </span>
            )}
          </div>

            {preview && packId && (
              <div style={{ marginTop: 18 }}>
                <PreviewGrid
                  files={preview}
                  croppedFiles={new Set(Object.keys(crops))}
                  ownImageFiles={new Set(Object.keys(fileSources))}
                  onEdit={setEditing}
                />
              </div>
            )}
          </section>
        </StepPanel>

        {/* Both need a saved pack. While there is none the steps are locked,
            and StepPanel shows the locked notice instead of these. */}
        <StepPanel {...panel("sampletags")}>
          {packId && (
            <section className="step">
              <h2>Sample tags</h2>
              <SampleTagsPanel packId={packId} onSaved={() => setRulesVersion((n) => n + 1)} />
            </section>
          )}
        </StepPanel>

        <StepPanel {...panel("install")}>
          {packId && (
            <section className="step">
              <h2>Install</h2>
              <InstallPanel
                packId={packId}
                onChanged={() => {
                  setKitsToken((n) => n + 1);
                  void refreshPacks();
                }}
                rulesVersion={rulesVersion}
              />
            </section>
          )}
        </StepPanel>

        {visited.has("packs") && (
        <section className="step" hidden={view !== "packs"}>
          <h2>Your packs</h2>
          <LibraryPanel
            packs={packs}
            activeId={packId}
            onOpen={openPack}
            onDelete={removePack}
          />
        </section>
        )}

        {visited.has("presets") && tools.some((t) => t.id === "presets") && (
          <section className="step" hidden={view !== "presets"}>
            <h2>Preset tags (GENERAL, TYPES, CHARACTERS)</h2>
            <PresetEditor />
          </section>
        )}

        {visited.has("batch") && tools.some((t) => t.id === "batch") && (
          <section className="step" hidden={view !== "batch"}>
            <h2>Batch preset tags</h2>
            <BatchTagPanel />
          </section>
        )}

        {visited.has("calibrate") && (
          <section className="step" hidden={view !== "calibrate"}>
            <h2>Calibrate against your installed libraries</h2>
            <CalibratePanel onDone={refreshStatus} />
          </section>
        )}

        {visited.has("settings") && (
          <section className="step" hidden={view !== "settings"}>
            <h2>Settings</h2>
            <SettingsPanel onSaved={refreshStatus} />
          </section>
        )}

        {isStep(view) && <StepNav views={views} current={view} onGo={go} />}
      </main>
      </div>

      {editing && packId && !replacing && (
        <CropEditor
          file={editing.file}
          targetW={editing.width}
          targetH={editing.height}
          sourceUrl={`/api/packs/${packId}/source?which=${
            fileSources[editing.file] ??
            (preview && SPEC_LOGO_FILES.has(editing.file) && useSeparateLogo ? "logo" : "artwork")
          }&v=${sourceVersion}`}
          initial={crops[editing.file] ?? null}
          onSave={(c) => saveCrop(editing.file, c)}
          onClose={() => setEditing(null)}
          ownImage={editing.file in fileSources}
          onReplace={() => setReplacing(editing)}
          onUseGroupImage={async () => {
            const res = await fetch(`/api/packs/${packId}/images?file=${encodeURIComponent(editing.file)}`, { method: "DELETE" });
            const json = await res.json();
            if (!res.ok) { setError(json.error ?? "Could not go back to the pack's image."); return; }
            await applySavedPack(json.pack as Pack).catch((err: Error) => setError(err.message));
          }}
        />
      )}
      {replacing && packId && (
        <ReplaceImageDialog
          packId={packId}
          file={replacing}
          fileSources={fileSources}
          hasLogo={useSeparateLogo}
          hasOpenAiKey={status?.hasOpenAiKey ?? false}
          hasSerpKey={status?.hasSerpKey ?? false}
          searchSeed={[vendor, product].filter(Boolean).join(" ")}
          onDone={async (pack) => {
            setReplacing(null);
            await applySavedPack(pack).catch((err: Error) => setError(err.message));
          }}
          onClose={() => setReplacing(null)}
        />
      )}
    </>
  );
}

/** Why Next is off on an unfinished required step. */
const UNFINISHED: Partial<Record<StepId, string>> = {
  kit: "Pick a kit type first.",
  name: "Enter a valid name first.",
  browser: "Pick at least one category first.",
  artwork: "Add an artwork image first.",
  review: "Build the images first.",
};

function StepNav({
  views,
  current,
  onGo,
}: {
  views: ReturnType<typeof stepViews>;
  current: StepId;
  onGo: (id: StepId) => void;
}) {
  const here = views.find((v) => v.id === current);
  if (!here || here.state === "locked") return null;
  const back = prevStep(views, current);
  const next = nextStep(views, current);
  const isLast = views[views.length - 1]?.id === current;
  return (
    <div className="step-nav">
      <button type="button" className="btn ghost" onClick={() => back && onGo(back)} disabled={!back}>
        Back
      </button>
      {!isLast && (
        <button type="button" className="btn" onClick={() => next && onGo(next)} disabled={!next}>
          Next step
        </button>
      )}
      {!isLast && !next && <span className="why">{UNFINISHED[current]}</span>}
    </div>
  );
}
