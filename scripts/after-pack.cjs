// electron-builder drops node_modules from extraResources, so the standalone
// server is copied here instead. afterPack runs before signing, so the copy
// is signed with the rest of the app.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const dest = path.join(app, "Contents", "Resources", "server");
  const src = path.join(context.packager.projectDir, ".next", "standalone");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
  for (const p of ["server.js", "node_modules/sharp", "node_modules/@img/sharp-darwin-arm64", ".next/static"]) {
    if (!fs.existsSync(path.join(dest, p))) throw new Error(`after-pack: ${p} is missing from the packaged server.`);
  }
};
