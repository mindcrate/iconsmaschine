"use client";

import { useCallback, useEffect, useState } from "react";
import { ArtworkPicker, type ArtworkSource } from "@/components/ArtworkPicker";
import { CalibratePanel } from "@/components/CalibratePanel";
import { InstallPanel } from "@/components/InstallPanel";
import { LibraryPanel } from "@/components/LibraryPanel";
import { PreviewGrid } from "@/components/PreviewGrid";
import { getJson, sendForm } from "@/lib/client";
import { KIT_TYPES, validateFolderName, type KitType } from "@/lib/spec";
import type { AppStatus, Pack, PreviewFile } from "@/lib/types";

export default function Page() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);

  const [kitType, setKitType] = useState<KitType>("sample_kit");
  const [vendor, setVendor] = useState("");
  const [subfolder, setSubfolder] = useState("");
  const [name, setName] = useState("");
  const [author, setAuthor] = useState("");
  const [share, setShare] = useState(false);
  const [tags, setTags] = useState("");
  const [nks2, setNks2] = useState(true);
  const [background, setBackground] = useState("#101010");
  const [transparent, setTransparent] = useState(true);
  const [padding, setPadding] = useState(0.08);

  const [artwork, setArtwork] = useState<ArtworkSource | null>(null);
  const [logo, setLogo] = useState<ArtworkSource | null>(null);
  const [useSeparateLogo, setUseSeparateLogo] = useState(false);

  const [packId, setPackId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kitInfo = KIT_TYPES.find((k) => k.id === kitType)!;
  const vendorError = vendor ? validateFolderName(vendor) : null;
  const subError = subfolder ? validateFolderName(subfolder) : null;
  const canBuild = Boolean(artwork) && Boolean(vendor) && !vendorError && !subError;

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

  useEffect(() => {
    void refreshStatus();
    void refreshPacks();
  }, [refreshStatus, refreshPacks]);

  function resetOutputs() {
    setPreview(null);
    setPackId(null);
  }

  async function build() {
    if (!artwork) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("kitType", kitType);
      form.set("vendor", vendor);
      form.set("subfolder", kitInfo.usesSubfolder ? subfolder : "");
      form.set("name", name);
      form.set("author", author);
      form.set("share", String(share));
      form.set("tags", tags);
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

  function openPack(pack: Pack) {
    setKitType(pack.kitType);
    setVendor(pack.vendor);
    setSubfolder(pack.subfolder ?? "");
    setName(pack.name);
    setAuthor(pack.author);
    setShare(pack.share);
    setTags(pack.tags.join(", "));
    setNks2(pack.nks2);
    setTransparent(pack.background === null);
    if (pack.background) setBackground(pack.background);
    setPadding(pack.padding);
    setPackId(pack.id);
    setPreview(null);
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
    window.scrollTo({ top: 0, behavior: "smooth" });
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
      <header className="top">
        <div className="inner">
          <h1>
            icon<span>maschine</span>
          </h1>
          <span className="tag">
            Custom browser images for third-party Maschine content
          </span>
          <div className="status-bar">
            {status && (
              <>
                <span className={status.rootWritable ? "chip ok" : "chip warn"}>
                  {status.rootWritable
                    ? "NI Resources writable"
                    : status.rootExists
                      ? "NI Resources read-only"
                      : "NI Resources not found"}
                </span>
                <span className={status.hasOpenAiKey ? "chip ok" : "chip"}>
                  {status.hasOpenAiKey ? "OpenAI key loaded" : "no OpenAI key"}
                </span>
                <span className={status.hasMetaTemplate ? "chip ok" : "chip warn"}>
                  {status.hasMetaTemplate ? ".meta template ready" : "no .meta template"}
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="shell">
        <section className="step">
          <h2>
            <span className="letter">A</span>Choose your kit type
          </h2>
          <p className="hint">
            This decides the folder shape the pack installs into.
          </p>
          <div className="kit-grid">
            {KIT_TYPES.map((k) => (
              <button
                key={k.id}
                className="kit-card"
                aria-pressed={kitType === k.id}
                onClick={() => {
                  setKitType(k.id);
                  resetOutputs();
                }}
              >
                <strong>{k.label}</strong>
                <span>{k.blurb}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="step">
          <h2>
            <span className="letter">B</span>Name the folder
          </h2>
          <p className="hint">
            The name must be <strong>exactly</strong> the name Maschine shows for the
            kit, library or plugin vendor. No special characters ($ % &amp; @ # ! _).
          </p>

          <div className="row">
            <div className="field">
              <label>
                {kitInfo.usesSubfolder ? "Plugin vendor folder" : `${kitInfo.label} folder name`}
              </label>
              <input
                type="text"
                placeholder={kitInfo.nameHint}
                value={vendor}
                onChange={(e) => {
                  setVendor(e.target.value);
                  resetOutputs();
                }}
              />
              {vendorError && (
                <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 5 }}>
                  {vendorError}
                </div>
              )}
            </div>

            {kitInfo.usesSubfolder && (
              <div className="field">
                <label>
                  Plugin subfolder
                  <span className="sub">optional</span>
                </label>
                <input
                  type="text"
                  placeholder="Sylenth1"
                  value={subfolder}
                  onChange={(e) => {
                    setSubfolder(e.target.value);
                    resetOutputs();
                  }}
                />
                {subError && (
                  <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 5 }}>
                    {subError}
                  </div>
                )}
              </div>
            )}
          </div>

          {kitInfo.usesSubfolder && (
            <p className="hint" style={{ marginBottom: 12 }}>
              Only add a subfolder when one vendor ships several plugins and you want
              different images for each (e.g. Sugar Bytes &gt; Looperator, WOW2,
              Effectrix). Use the plugin name exactly as Maschine shows it.
            </p>
          )}

          {kitType === "kontakt" && (
            <div className="note">
              Maschine only supports images for NI-approved Kontakt Player libraries.
              Unofficial libraries and user Groups/Sounds will not pick these up.
            </div>
          )}

          {kitType === "group" && (
            <div className="note">
              Stock Maschine does not read custom images for user Groups. This builds
              the pack anyway so it is ready if you keep Groups under a vendor-style
              folder.
            </div>
          )}

          {vendor && !vendorError && status && (
            <div className="path-preview">
              {status.niImageDir}/<b>{vendor}</b>
              {kitInfo.usesSubfolder && subfolder && !subError ? (
                <>
                  /<b>{subfolder}</b>
                </>
              ) : null}
              /
            </div>
          )}
        </section>

        <section className="step">
          <h2>
            <span className="letter">C</span>Add your artwork
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

        <section className="step">
          <h2>
            <span className="letter">D</span>Pack details
          </h2>
          <div className="row">
            <div className="field">
              <label>
                Pack name<span className="sub">for your library here</span>
              </label>
              <input
                type="text"
                placeholder={vendor || "Blap Kit"}
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

          <div className="actions">
            <button className="btn" onClick={build} disabled={!canBuild || busy}>
              {busy ? <><span className="spinner" /> Building…</> : "Build the images"}
            </button>
            {!artwork && (
              <span style={{ color: "var(--muted)", fontSize: 12 }}>
                Add artwork in step C first.
              </span>
            )}
          </div>

          {error && <div className="note bad">{error}</div>}
        </section>

        {preview && packId && (
          <section className="step">
            <h2>
              <span className="letter">E</span>Review and install
            </h2>
            <p className="hint">
              {preview.length} files ready. Check the crops, then install straight into
              NI Resources.
            </p>
            <PreviewGrid files={preview} />
            <div style={{ marginTop: 22 }}>
              <InstallPanel packId={packId} />
            </div>
          </section>
        )}

        <section className="step">
          <h2>Your packs</h2>
          <LibraryPanel
            packs={packs}
            activeId={packId}
            onOpen={openPack}
            onDelete={removePack}
          />
        </section>

        <section className="step">
          <h2>Calibrate against your installed libraries</h2>
          <CalibratePanel onDone={refreshStatus} />
        </section>
      </div>
    </>
  );
}
