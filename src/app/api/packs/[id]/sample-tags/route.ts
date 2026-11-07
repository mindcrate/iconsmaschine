import path from "node:path";
import { jsonError } from "@/lib/form";
import { userLibrarySamples } from "@/lib/kits";
import { folderOf, parseSampleTags } from "@/lib/sampletags";
import { suggestFolders } from "@/lib/samplesuggest";
import { readPack, savePack } from "@/lib/store";
import { readTagVocabulary } from "@/lib/tagvocab";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** The library's folders with file counts and suggestions, the saved rules, and the names to pick from. */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const pack = await readPack(id);
    if (!pack) return Response.json({ error: "Pack not found." }, { status: 404 });

    const [{ samples, nonWav, note }, vocab] = await Promise.all([
      userLibrarySamples(pack.product),
      readTagVocabulary(),
    ]);

    const files = new Map<string, string[]>();
    for (const s of samples) {
      const folder = folderOf(s);
      const name = path.basename(s.path, path.extname(s.path));
      files.set(folder, [...(files.get(folder) ?? []), name]);
    }
    // A folder that holds only sub-folders still needs a row, so a rule can sit on it.
    for (const folder of [...files.keys()]) {
      const parts = folder ? folder.split("/") : [];
      for (let i = 0; i < parts.length; i++) {
        const parent = parts.slice(0, i).join("/");
        if (!files.has(parent)) files.set(parent, []);
      }
    }
    const folders = [...files.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([folder, names]) => ({ folder, files: names }));

    return Response.json({
      folders: folders.map(({ folder, files }) => ({ folder, files: files.length })),
      suggestions: suggestFolders(folders, new Set(vocab.types.map((t) => t.join(" > ")))),
      nonWav: nonWav.length,
      sampleTags: pack.sampleTags,
      types: vocab.sampleTypes,
      characters: vocab.sampleCharacters,
      note: note ?? null,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PUT(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const pack = await readPack(id);
    if (!pack) return Response.json({ error: "Pack not found." }, { status: 404 });
    const sampleTags = parseSampleTags(await request.json().catch(() => null));
    const saved = await savePack({ ...pack, sampleTags });
    return Response.json({ sampleTags: saved.sampleTags });
  } catch (err) {
    return jsonError(err);
  }
}
