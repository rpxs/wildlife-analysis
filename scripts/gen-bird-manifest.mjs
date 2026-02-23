import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const sourceDir = path.join(rootDir, "birds");
const publicBirdsDir = path.join(rootDir, "public", "birds");
const exts = new Set([".png", ".jpg", ".jpeg", ".webp"]);

await mkdir(publicBirdsDir, { recursive: true });

const sourceFiles = await listImageFiles(sourceDir);
const publicFiles = await listImageFiles(publicBirdsDir);

let chosenFiles = publicFiles;
let chosenDir = publicBirdsDir;

if (sourceFiles.length > 0) {
  chosenFiles = sourceFiles;
  chosenDir = sourceDir;
  await Promise.all(
    sourceFiles.map((name) =>
      copyFile(path.join(sourceDir, name), path.join(publicBirdsDir, name)),
    ),
  );
}

if (chosenFiles.length === 0) {
  console.warn(
    "No bird images found. Add jpg/png/webp files to /birds (preferred) or /public/birds.",
  );
}

const manifest = {
  generatedAt: new Date().toISOString(),
  sourceDirectory: path.relative(rootDir, chosenDir).replaceAll("\\", "/"),
  files: chosenFiles.map((name) => `/birds/${name}`),
};

await writeFile(
  path.join(publicBirdsDir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  "utf8",
);

console.log(
  `Generated public/birds/manifest.json with ${chosenFiles.length} images (source: ${manifest.sourceDirectory || "."}).`,
);

async function listImageFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => exts.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
