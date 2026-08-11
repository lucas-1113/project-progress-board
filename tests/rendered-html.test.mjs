import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("builds a portable GitHub Pages PWA shell", async () => {
  const [html, manifest, worker, files] = await Promise.all([
    readFile(new URL("dist-pages/index.html", root), "utf8"),
    readFile(new URL("public/manifest.webmanifest", root), "utf8"),
    readFile(new URL("public/sw.js", root), "utf8"),
    readdir(new URL("dist-pages/", root)),
  ]);

  assert.match(html, /<html lang="zh-CN">/i);
  assert.match(html, /<title>项目进度看板<\/title>/i);
  assert.match(html, /href="\.\/manifest\.webmanifest"/i);
  assert.match(html, /src="\.\/assets\//i);
  assert.ok(files.includes("icon-192.png"));
  assert.ok(files.includes("icon-512.png"));
  assert.ok(files.includes("sw.js"));

  const parsedManifest = JSON.parse(manifest);
  assert.equal(parsedManifest.display, "standalone");
  assert.equal(parsedManifest.start_url, "./");
  assert.equal(parsedManifest.scope, "./");
  assert.match(worker, /project-board-/);
});

test("keeps real template data out of the public application bundle", async () => {
  const [html, assets, boardSource] = await Promise.all([
    readFile(new URL("dist-pages/index.html", root), "utf8"),
    readdir(new URL("dist-pages/assets/", root)),
    readFile(new URL("app/ProjectBoard.tsx", root), "utf8"),
  ]);
  const assetText = (
    await Promise.all(
      assets.map((file) => readFile(new URL(`dist-pages/assets/${file}`, root), "utf8")),
    )
  ).join("\n");
  const publicOutput = `${html}\n${assetText}`;

  assert.doesNotMatch(publicOutput, /RL-134C|研发部项目进度追踪表模版|\/Users\/lumen/);
  assert.match(boardSource, /openImport/);
  assert.match(boardSource, /openExport/);
  assert.match(boardSource, /runBackupOperation/);
  assert.match(boardSource, /exportProjectCsv/);
  assert.match(boardSource, /exportMilestoneCsv/);
  assert.match(boardSource, /existing\.length \+ files\.length > 8/);
  assert.match(boardSource, /project-board-compact-mode/);
  assert.match(boardSource, /fitBoardToViewport/);
  assert.match(boardSource, /已自动适配/);
});
