const fs = require("fs");
const path = require("path");

const OUT_DIR = "iorien-wiki/tiddlers";
const EXCLUDE_DIRS = new Set([".git", ".github", "iorien-wiki", "node_modules", "scripts"]);

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

function slugToTitle(name) {
  return name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function convertLinks(content) {
  return content.replace(/\[([^\]]+)\]\((?:\.\.\/)*(?:[\w-]+\/)*([\w-]+)\.md\)/g,
    (_, text, name) => `[[${text}|${slugToTitle(name)}]]`);
}

function findMarkdownFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      results.push(...findMarkdownFiles(full));
    } else if (entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

function convert(filePath) {
  const name = path.basename(filePath, ".md");
  const parentDir = path.dirname(filePath);
  const tag = parentDir === "." ? null : parentDir.split(path.sep)[0];
  const content = convertLinks(fs.readFileSync(filePath, "utf8"));
  const title = slugToTitle(name);
  const tid = `title: ${title}\ntype: text/markdown${tag ? `\ntags: ${tag}` : ""}\n\n${content}`;
  fs.writeFileSync(path.join(OUT_DIR, `${name}.tid`), tid);
}

findMarkdownFiles(".").forEach(convert);

const READONLY_CONFIG = [
  ["$:/config/ViewToolbarButtons/Visibility/$:/core/ui/Buttons/edit", "hide"],
  ["$:/config/ViewToolbarButtons/Visibility/$:/core/ui/Buttons/delete-tiddler", "hide"],
  ["$:/config/ViewToolbarButtons/Visibility/$:/core/ui/Buttons/clone", "hide"],
  ["$:/config/PageControlButtons/Visibility/$:/core/ui/PageControls/new-tiddler", "hide"],
  ["$:/config/PageControlButtons/Visibility/$:/core/ui/PageControls/new-journal", "hide"],
];

for (const [title, text] of READONLY_CONFIG) {
  fs.writeFileSync(
    path.join(OUT_DIR, `${title.split("/").pop()}.tid`),
    `title: ${title}\n\n${text}`
  );
}
