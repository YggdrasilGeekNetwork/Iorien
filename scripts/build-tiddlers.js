const fs = require("fs");
const path = require("path");

const SRC_DIRS = ["cosmologia", "plano-material", "referencias"];
const SRC_ROOT_FILES = ["contexto_campanha.md"];
const OUT_DIR = "iorien-wiki/tiddlers";

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

function slugToTitle(name) {
  return name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function convert(filePath, tag) {
  const name = path.basename(filePath, ".md");
  const content = fs.readFileSync(filePath, "utf8");
  const title = slugToTitle(name);
  const tid = `title: ${title}\ntype: text/markdown${tag ? `\ntags: ${tag}` : ""}\n\n${content}`;
  fs.writeFileSync(path.join(OUT_DIR, `${name}.tid`), tid);
}

for (const dir of SRC_DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith(".md")) convert(path.join(dir, file), dir);
  }
}
for (const file of SRC_ROOT_FILES) {
  if (fs.existsSync(file)) convert(file, null);
}
