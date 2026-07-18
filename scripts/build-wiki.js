const fs = require("fs");
const path = require("path");
const MarkdownIt = require("markdown-it");
const { encryptSecret } = require("./crypto-secrets.js");

const OUT_DIR = "site";
const EXCLUDE_DIRS = new Set([".git", ".github", "node_modules", "scripts", OUT_DIR, "images_temp"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);

const md = new MarkdownIt({ html: true, linkify: true });

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

function loadRoleConfig() {
  const rolesPath = path.join(__dirname, "roles.json");
  if (!fs.existsSync(rolesPath)) return {};
  return JSON.parse(fs.readFileSync(rolesPath, "utf8"));
}

const roleConfig = loadRoleConfig();
if (Object.keys(roleConfig).length === 0) {
  console.warn(
    "aviso: scripts/roles.json ausente ou vazio — todo conteúdo marcado como secreto " +
      "ficará permanentemente ilegível nesta build."
  );
}

function slugToTitle(name) {
  return name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function findFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      results.push(...findFiles(full));
    } else if (entry.name.endsWith(".md") || IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

const allFiles = findFiles(".");
const imageFiles = allFiles.filter(f => !f.endsWith(".md"));
// `<!-- exclude -->` opts a file out of the generated site entirely (no page, no nav
// entry, no search-index row) — for repo docs that live alongside the lore but
// aren't wiki content, e.g. referencias/instrucoes-gpt.md.
const mdFiles = allFiles.filter(f => {
  if (!f.endsWith(".md")) return false;
  const raw = fs.readFileSync(f, "utf8");
  return !extractPageMarkers(raw).markers.exclude;
});

// Output path mirrors the source path 1:1, README.md -> index.html for clean per-folder URLs.
function outPathFor(file) {
  const dir = path.dirname(file);
  const base = path.basename(file, ".md");
  const name = /^readme$/i.test(base) ? "index" : base;
  return path.normalize(dir === "." ? `${name}.html` : path.join(dir, `${name}.html`));
}

// Leading `<!-- marker -->` comment lines configure the page: `secret: role1, role2`
// restricts the whole page to those roles (title still shows in nav/search with a
// lock icon, only the body is encrypted); `no-toc` skips the generated sumário aside
// (for pages like the README/reference docs where a TOC adds no value); `copyable`
// adds a button next to the title that copies the whole page's markdown source;
// `exclude` drops the file from the generated site entirely (no page, no nav entry,
// no search-index row) — for repo docs that aren't wiki content. Markers stack in
// any order; an unrecognized leading comment is left alone as regular content.
function extractPageMarkers(content) {
  const trimmed = content.replace(/^﻿/, "").trimStart();
  let rest = trimmed;
  const markers = { secretRoles: null, hideToc: false, copyable: false, exclude: false };
  for (;;) {
    const match = rest.match(/^<!--\s*([^>]+?)\s*-->\s*\n/);
    if (!match) break;
    const inner = match[1].trim();
    if (/^secret:/i.test(inner)) {
      markers.secretRoles = inner
        .replace(/^secret:/i, "")
        .split(",")
        .map(r => r.trim())
        .filter(Boolean);
    } else if (/^no-toc$/i.test(inner)) {
      markers.hideToc = true;
    } else if (/^copyable$/i.test(inner)) {
      markers.copyable = true;
    } else if (/^exclude$/i.test(inner)) {
      markers.exclude = true;
    } else {
      break;
    }
    rest = rest.slice(match[0].length);
  }
  return { markers, rest };
}

function extractTitle(content, fallbackBase) {
  const trimmed = content.trimStart();
  const match = trimmed.match(/^#\s+(.+?)\s*\n/);
  if (match) {
    return { title: match[1].trim(), body: trimmed.slice(match[0].length) };
  }
  return { title: slugToTitle(fallbackBase), body: content };
}

const infoByFile = new Map();
for (const file of mdFiles) {
  const raw = fs.readFileSync(file, "utf8");
  const base = path.basename(file, ".md");
  const { markers, rest } = extractPageMarkers(raw);
  const { title } = extractTitle(rest, base);
  infoByFile.set(path.normalize(file), { title, outPath: outPathFor(file), secret: !!markers.secretRoles });
}

function relativeUrl(fromOutPath, toOutPath) {
  const rel = path.relative(path.dirname(fromOutPath), toOutPath);
  return rel.split(path.sep).join("/");
}

function rootPrefixFor(outPath) {
  const depth = outPath.split(path.sep).length - 1;
  return depth === 0 ? "" : "../".repeat(depth);
}

function convertLinks(content, filePath) {
  return content.replace(/\[([^\]]+)\]\(([^)\s]+\.md)\)/g, (match, text, relPath) => {
    const resolved = path.normalize(path.join(path.dirname(filePath), relPath));
    const info = infoByFile.get(resolved);
    if (!info) return match;
    const url = relativeUrl(infoByFile.get(path.normalize(filePath)).outPath, info.outPath);
    return `[${text}](${url})`;
  });
}

// Generic "copy to clipboard" button: carries its own text as base64 in a data
// attribute so scripts/assets/copy.js can decode and copy it without depending on
// whatever HTML happens to render around it. Reusable anywhere a raw text snippet
// needs a copy affordance (collapsible sections, whole-page copy, future uses).
function copyButton(rawText, label) {
  const encoded = Buffer.from(rawText, "utf8").toString("base64");
  const safeLabel = escapeHtml(label);
  return (
    `<button type="button" class="copy-button" data-copy-text="${encoded}" data-label="📋" ` +
    `title="${safeLabel}" aria-label="${safeLabel}">📋</button>`
  );
}

// Wraps raw markdown in a collapsible <details> with a copy button next to the
// summary label. The body stays as raw markdown (not pre-rendered HTML) inside the
// wrapping tags so the outer markdown-it pass still parses it as normal markdown —
// same html:true passthrough behavior already relied on for plain <details> blocks.
function copyableDetails(label, rawText) {
  return (
    `<details class="copyable">\n` +
    `<summary>${escapeHtml(label)} ${copyButton(rawText, "Copiar " + label)}</summary>\n\n` +
    `<div class="copyable-content">\n\n${rawText.trim()}\n\n</div>\n\n` +
    `</details>`
  );
}

// "Contexto para Agentes" is a copy-paste utility section, not reader content, so it's
// collapsed by default and left out of the human-facing TOC (raw HTML isn't a heading token).
function collapseAgentContext(content) {
  return content.replace(
    /## Contexto para Agentes\n\n([\s\S]*)$/,
    (match, body) => copyableDetails("Contexto para Agentes", body.trim())
  );
}

// `:::copyable Label\n...\n:::` is the author-facing version of the same closure:
// wrap any section of any page, anywhere, in a collapsible block with a copy button.
// "Contexto para Agentes" above is just this repo's one standing convention built on
// top of the same copyableDetails() primitive — this is the general-purpose escape
// hatch for everything else.
function extractCopyableBlocks(content) {
  return content.replace(
    /:::copyable ([^\n]+)\n([\s\S]*?)\n:::/g,
    (match, label, body) => copyableDetails(label.trim(), body.trim())
  );
}

function secretPlaceholder(secret, lockedLabel, extraClass) {
  const dataAttr = Buffer.from(JSON.stringify(secret)).toString("base64");
  return (
    `<div class="secret-block${extraClass ? " " + extraClass : ""}" data-secret="${dataAttr}">\n` +
    `<div class="secret-locked">🔒 ${lockedLabel}</div>\n` +
    `<div class="secret-content" hidden></div>\n` +
    `</div>`
  );
}

// Extracts `:::secret role1,role2\n...\n:::` blocks from raw markdown, renders their
// inner markdown to HTML, encrypts it (envelope per role), and splices in an opaque
// placeholder in their place. Index-based reconstruction (not String.replace) so
// duplicate block bodies in the same file don't collide.
async function extractInlineSecrets(content, filePath) {
  const regex = /:::secret ([^\n]+)\n([\s\S]*?)\n:::/g;
  const matches = [...content.matchAll(regex)];
  if (matches.length === 0) return { content, removedText: "" };

  let result = "";
  let lastIndex = 0;
  let removedText = "";
  for (const match of matches) {
    const [full, rolesStr, inner] = match;
    result += content.slice(lastIndex, match.index);
    const roles = rolesStr.split(",").map(r => r.trim()).filter(Boolean);
    const innerHtml = md.render(convertLinks(inner, filePath));
    const secret = await encryptSecret(innerHtml, roles, roleConfig);
    result += secretPlaceholder(secret, "Conteúdo restrito — desbloqueie na barra lateral para ver.");
    removedText += " " + inner;
    lastIndex = match.index + full.length;
  }
  result += content.slice(lastIndex);
  return { content: result, removedText };
}

// Render via the token API (not the md.render() shortcut) so heading ids can be
// injected before rendering, which both anchors and the generated TOC rely on.
function renderWithToc(content) {
  const tokens = md.parse(content, {});
  const toc = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "heading_open" && (token.tag === "h2" || token.tag === "h3")) {
      const inline = tokens[i + 1];
      const text = inline.content;
      const slug = slugify(text);
      token.attrSet("id", slug);
      toc.push({ level: token.tag, text, slug });
    }
  }
  const html = md.renderer.render(tokens, md.options, {});
  return { html, toc };
}

function renderToc(toc) {
  if (toc.length === 0) return "";
  const items = toc
    .map(h => `<li class="toc-${h.level}"><a href="#${h.slug}">${escapeHtml(h.text)}</a></li>`)
    .join("\n");
  return `<nav class="toc"><div class="toc-title">Sumário</div><ul>${items}</ul></nav>`;
}

function toPlainText(mdContent) {
  return mdContent
    .replace(/<[^>]+>/g, " ")
    .replace(/:::copyable [^\n]+/g, " ")
    .replace(/^:::\s*$/gm, " ")
    .replace(/`{1,3}[^`]*`{1,3}/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~`|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Nav tree mirrors the folder structure; a folder's own README/index becomes the
// clickable label on its <details> summary, so directories double as index links.
function buildTree(files) {
  const root = { type: "dir", name: "", children: {} };
  for (const file of files) {
    const parts = file.split(path.sep);
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      node.children[part] = node.children[part] || { type: "dir", name: part, children: {} };
      node = node.children[part];
    }
    node.children[parts[parts.length - 1]] = { type: "file", name: parts[parts.length - 1], file };
  }
  return root;
}

function findIndexFile(dirNode) {
  const entry = Object.values(dirNode.children).find(
    c => c.type === "file" && /^readme\.md$/i.test(c.name)
  );
  return entry ? entry.file : null;
}

function containsOutPath(dirNode, targetOutPath) {
  for (const child of Object.values(dirNode.children)) {
    if (child.type === "file") {
      if (infoByFile.get(path.normalize(child.file)).outPath === targetOutPath) return true;
    } else if (containsOutPath(child, targetOutPath)) {
      return true;
    }
  }
  return false;
}

function renderNav(node, currentOutPath, rootPrefix) {
  const dirs = [];
  const files = [];
  for (const child of Object.values(node.children)) {
    (child.type === "dir" ? dirs : files).push(child);
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  let html = "<ul>";
  for (const f of files) {
    if (/^readme\.md$/i.test(f.name)) continue;
    const info = infoByFile.get(path.normalize(f.file));
    const href = rootPrefix + info.outPath.split(path.sep).join("/");
    const active = info.outPath === currentOutPath ? ' class="active"' : "";
    const lock = info.secret ? "🔒 " : "";
    html += `<li><a href="${href}"${active}>${lock}${escapeHtml(info.title)}</a></li>`;
  }
  for (const d of dirs) {
    const indexFile = findIndexFile(d);
    const indexInfo = indexFile ? infoByFile.get(path.normalize(indexFile)) : null;
    const lock = indexInfo && indexInfo.secret ? "🔒 " : "";
    const label = indexInfo
      ? `<a href="${rootPrefix + indexInfo.outPath.split(path.sep).join("/")}">${lock}${escapeHtml(slugToTitle(d.name))}</a>`
      : escapeHtml(slugToTitle(d.name));
    const open = containsOutPath(d, currentOutPath) ? " open" : "";
    html += `<li><details${open}><summary>${label}</summary>${renderNav(d, currentOutPath, rootPrefix)}</details></li>`;
  }
  html += "</ul>";
  return html;
}

const navTree = buildTree(mdFiles);

// Inline (not an external file) so the stored theme applies before first paint —
// an external script would still flash the default theme while it downloads/parses.
const THEME_BOOTSTRAP = `<script>(function(){try{var t=localStorage.getItem("wiki-theme");if(t)document.documentElement.setAttribute("data-theme",t);}catch(e){}})();</script>`;

function pageTemplate({ title, navHtml, tocHtml, contentHtml, rootPrefix, pageCopyButtonHtml }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Wiki de Iorién</title>
<link rel="stylesheet" href="${rootPrefix}assets/style.css">
${THEME_BOOTSTRAP}
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <div class="sidebar-header">
      <a href="${rootPrefix}index.html">Wiki de Iorién</a>
      <button type="button" id="theme-toggle" title="Alternar modo claro/escuro" aria-label="Alternar modo claro/escuro">🌙</button>
    </div>
    <div class="search-box">
      <input type="search" id="search-input" placeholder="Buscar…" autocomplete="off">
      <div id="search-results"></div>
    </div>
    <details class="unlock-box">
      <summary>🔐 Acesso restrito</summary>
      <form id="unlock-form" autocomplete="off">
        <input type="password" id="unlock-input" placeholder="Senha de acesso">
        <button type="submit">Desbloquear</button>
      </form>
      <div id="unlock-status"></div>
      <button type="button" id="forget-button">Esquecer senhas</button>
    </details>
    <nav class="site-nav">${navHtml}</nav>
  </aside>
  <main class="content">
    <div class="content-row">
      <article>
        <div class="article-header">
          <h1>${escapeHtml(title)}</h1>
          ${pageCopyButtonHtml || ""}
        </div>
        ${contentHtml}
      </article>
      ${tocHtml ? `<aside class="page-toc">${tocHtml}</aside>` : ""}
    </div>
  </main>
</div>
<script src="${rootPrefix}assets/search.js" data-index="${rootPrefix}search-index.json" data-root="${rootPrefix}"></script>
<script src="${rootPrefix}assets/secrets.js"></script>
<script src="${rootPrefix}assets/copy.js"></script>
<script src="${rootPrefix}assets/theme.js"></script>
</body>
</html>
`;
}

async function build() {
  const searchIndex = [];

  for (const file of mdFiles) {
    const info = infoByFile.get(path.normalize(file));
    const raw = fs.readFileSync(file, "utf8");
    const { markers, rest } = extractPageMarkers(raw);
    const pageRoles = markers.secretRoles;
    const { title, body } = extractTitle(rest, path.basename(file, ".md"));
    const linked = convertLinks(body, file);
    const { content: withInlineSecrets } = await extractInlineSecrets(linked, file);
    const finalMd = collapseAgentContext(extractCopyableBlocks(withInlineSecrets));
    const { html, toc } = renderWithToc(finalMd);

    let tocHtml = markers.hideToc ? "" : renderToc(toc);
    let contentHtml = html;
    if (pageRoles) {
      const secret = await encryptSecret(tocHtml + contentHtml, pageRoles, roleConfig);
      contentHtml = secretPlaceholder(
        secret,
        "Página restrita — desbloqueie na barra lateral para ver o conteúdo.",
        "secret-block-page"
      );
      tocHtml = "";
    }

    // Whole-page copy uses the post-secret-extraction markdown (placeholders instead of
    // raw secret text), same source the search index uses, so it can never leak a
    // secret block's plaintext even if this marker is ever combined with one.
    const pageCopyButtonHtml = markers.copyable
      ? copyButton(`# ${title}\n\n${withInlineSecrets.trim()}`, "Copiar página inteira")
      : "";

    const rootPrefix = rootPrefixFor(info.outPath);
    const navHtml = renderNav(navTree, info.outPath, rootPrefix);
    const page = pageTemplate({ title, navHtml, tocHtml, contentHtml, rootPrefix, pageCopyButtonHtml });
    const outFile = path.join(OUT_DIR, info.outPath);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, page);

    searchIndex.push({
      title,
      url: info.outPath.split(path.sep).join("/"),
      text: pageRoles ? "" : toPlainText(withInlineSecrets),
    });
  }

  for (const file of imageFiles) {
    const outFile = path.join(OUT_DIR, file);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.copyFileSync(file, outFile);
  }

  fs.mkdirSync(path.join(OUT_DIR, "assets"), { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "search-index.json"), JSON.stringify(searchIndex));
  fs.copyFileSync(path.join("scripts", "assets", "style.css"), path.join(OUT_DIR, "assets", "style.css"));
  fs.copyFileSync(path.join("scripts", "assets", "search.js"), path.join(OUT_DIR, "assets", "search.js"));
  fs.copyFileSync(path.join("scripts", "assets", "secrets.js"), path.join(OUT_DIR, "assets", "secrets.js"));
  fs.copyFileSync(path.join("scripts", "assets", "copy.js"), path.join(OUT_DIR, "assets", "copy.js"));
  fs.copyFileSync(path.join("scripts", "assets", "theme.js"), path.join(OUT_DIR, "assets", "theme.js"));

  console.log(`Wiki gerada em ${OUT_DIR}/ (${mdFiles.length} páginas, ${imageFiles.length} imagens)`);
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
