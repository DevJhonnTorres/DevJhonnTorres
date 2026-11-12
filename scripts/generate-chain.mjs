#!/usr/bin/env node
// Generates assets/commit-chain.svg: your latest public commits drawn as an
// animated blockchain. No dependencies; needs Node 18+ (global fetch).
//
// Env: GH_USER (default: DevJhonnTorres), GITHUB_TOKEN (optional, raises limits)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USER = process.env.GH_USER || "DevJhonnTorres";
const TOKEN = process.env.GITHUB_TOKEN || "";
const BLOCKS = 4;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/commit-chain.svg");

async function gh(path) {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "commit-chain-generator",
      ...(TOKEN && { Authorization: `Bearer ${TOKEN}` }),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function wrap(text, width, lines) {
  const words = text.split(/\s+/);
  const out = [""];
  for (const w of words) {
    const cur = out[out.length - 1];
    if (!cur) out[out.length - 1] = w;
    else if ((cur + " " + w).length <= width) out[out.length - 1] = cur + " " + w;
    else out.push(w);
  }
  const res = out.slice(0, lines).map((l) => cut(l, width));
  if (out.length > lines) res[lines - 1] = cut(res[lines - 1], width - 1) + "…";
  return res;
}

const TYPE_COLORS = {
  feat: "#3fb950", fix: "#f85149", refactor: "#bc8cff", chore: "#8b949e",
  docs: "#58a6ff", test: "#d29922", style: "#f778ba", perf: "#ffa657",
  build: "#79c0ff", ci: "#79c0ff", revert: "#ff7b72",
};

function parseMessage(msg) {
  const subject = msg.split("\n")[0].trim();
  const m = subject.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/);
  if (m && TYPE_COLORS[m[1].toLowerCase()]) {
    const type = m[1].toLowerCase();
    return { type, label: m[2] ? `${type}(${m[2]})` : type, text: m[3], color: TYPE_COLORS[type] };
  }
  return { type: "commit", label: "commit", text: subject, color: "#8b949e" };
}

async function main() {
  const q = encodeURIComponent(`author:${USER}`);
  const [search, user] = await Promise.all([
    gh(`search/commits?q=${q}&sort=author-date&order=desc&per_page=20`),
    gh(`users/${USER}`),
  ]);

  const seen = new Set();
  const commits = [];
  for (const it of search.items) {
    if (seen.has(it.sha)) continue;
    seen.add(it.sha);
    commits.push(it);
    if (commits.length === BLOCKS + 1) break; // +1 so the oldest shown block has a real prev hash
  }
  if (commits.length === 0) throw new Error("No public commits found");

  const total = search.total_count;
  // newest first from the API -> oldest first, left to right
  const shown = commits.slice(0, BLOCKS).reverse();
  const prevOfOldest = commits[BLOCKS]?.sha ?? "0".repeat(40);

  const blocks = shown.map((c, i) => ({
    height: total - (shown.length - 1 - i),
    hash: c.sha,
    prev: i === 0 ? prevOfOldest : shown[i - 1].sha,
    repo: c.repository.name,
    date: c.commit.author.date.slice(0, 10),
    ...parseMessage(c.commit.message),
  }));

  writeFileSync(OUT, render({ blocks, total, repos: user.public_repos }), "utf8");
  console.log(`Wrote ${OUT} (${blocks.length} blocks, ${total} total commits)`);
}

function render({ blocks, total, repos }) {
  const W = 960, H = 330;
  const BW = 160, BH = 184, GAP = 34, X0 = 12, Y0 = 66;
  const latest = blocks[blocks.length - 1];
  const updated = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

  const blockSvg = blocks.map((b, i) => {
    const x = X0 + i * (BW + GAP);
    const d = (i * 0.35).toFixed(2);
    const msg = wrap(b.text, 21, 2);
    const chipW = Math.min(b.label.length, 20) * 6.6 + 12;
    return `
  <g transform="translate(${x} ${Y0})"><g class="blk" style="animation-delay:${d}s">
    <rect class="card" width="${BW}" height="${BH}" rx="8"/>
    <text x="12" y="24" class="h">BLOCK #${b.height}</text>
    <text x="12" y="46" class="k">hash</text>
    <text x="46" y="46" class="v hash">0x${b.hash.slice(0, 12)}</text>
    <rect class="type" style="animation-delay:${(+d + 0.4).toFixed(2)}s" x="45" y="35" width="${BW - 50}" height="14"/>
    <text x="12" y="63" class="k">prev</text>
    <text x="46" y="63" class="v">0x${b.prev.slice(0, 12)}</text>
    <line x1="12" x2="${BW - 12}" y1="76" y2="76" class="sep"/>
    <rect x="12" y="86" width="${chipW}" height="18" rx="9" fill="${b.color}" fill-opacity=".15" stroke="${b.color}" stroke-opacity=".6"/>
    <text x="${12 + chipW / 2}" y="99" class="chip" fill="${b.color}" text-anchor="middle">${esc(cut(b.label, 20))}</text>
    ${msg.map((l, j) => `<text x="12" y="${124 + j * 16}" class="msg">${esc(l)}</text>`).join("\n    ")}
    <text x="12" y="164" class="k">⎇ ${esc(cut(b.repo, 21))}</text>
    <text x="12" y="178" class="k">◷ ${b.date}</text>
  </g></g>`;
  }).join("");

  const links = blocks.map((_, i) => {
    const x = X0 + i * (BW + GAP) + BW;
    const y = Y0 + BH / 2;
    return `
  <g transform="translate(${x} ${y})">
    <line x1="0" x2="${GAP}" y1="0" y2="0" class="link"/>
    <circle r="3" class="pulse" style="animation-delay:${(i * 0.3).toFixed(1)}s"/>
  </g>`;
  }).join("");

  const mx = X0 + blocks.length * (BW + GAP);
  const nonces = ["48213", "91027", "03355", "77410", "26981", "58802", "14466", "69134"];
  const mining = `
  <g transform="translate(${mx} ${Y0})"><g class="blk" style="animation-delay:${(blocks.length * 0.35).toFixed(2)}s">
    <rect class="card mining" width="${BW}" height="${BH}" rx="8"/>
    <rect class="found" width="${BW}" height="${BH}" rx="8"/>
    <text x="12" y="24" class="h">BLOCK #${total + 1}</text>
    <text x="12" y="46" class="k">prev</text>
    <text x="46" y="46" class="v">0x${latest.hash.slice(0, 12)}</text>
    <text x="12" y="63" class="k">diff</text>
    <text x="46" y="63" class="v">0x0000ffff</text>
    <line x1="12" x2="${BW - 12}" y1="76" y2="76" class="sep"/>
    <g class="mine">
      <text x="12" y="100" class="msg"><tspan class="pick">⛏</tspan> mining…</text>
      <text x="12" y="122" class="k">nonce</text>
      ${nonces.map((n, i) => `<text x="56" y="122" class="v nonce${i === 0 ? " n0" : ""}" style="animation-delay:${(i * 0.15).toFixed(2)}s">${n}</text>`).join("\n      ")}
      <rect x="12" y="136" width="${BW - 24}" height="8" rx="4" class="barbg"/>
      <rect x="12" y="136" width="${BW - 24}" height="8" rx="4" class="bar"/>
    </g>
    <g class="ok">
      <text x="${BW / 2}" y="112" class="okt" text-anchor="middle">✓ HASH FOUND</text>
      <text x="${BW / 2}" y="132" class="k" text-anchor="middle">waiting for next commit</text>
    </g>
    <text x="12" y="178" class="k">◷ pending</text>
  </g></g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Commit chain: latest commits by ${USER} as blocks">
<style>
  text { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .bg { fill: #0d1117; }
  .grid { stroke: #161b22; stroke-width: 1; }
  .title { fill: #e6edf3; font-size: 15px; font-weight: 700; letter-spacing: 1px; }
  .sub { fill: #8b949e; font-size: 11px; }
  .card { fill: #161b22; stroke: #30363d; stroke-width: 1.2; }
  .h { fill: #58a6ff; font-size: 13px; font-weight: 700; }
  .k { fill: #8b949e; font-size: 10.5px; }
  .v { fill: #c9d1d9; font-size: 10.5px; }
  .hash { fill: #3fb950; }
  .msg { fill: #e6edf3; font-size: 11.5px; }
  .chip { font-size: 10.5px; font-weight: 600; }
  .sep { stroke: #30363d; stroke-dasharray: 3 3; }
  .stat { fill: #e6edf3; font-size: 12px; }
  .stat tspan.n { fill: #3fb950; font-weight: 700; }
  .link { stroke: #3fb950; stroke-opacity: .45; stroke-width: 2; stroke-dasharray: 4 3; animation: flow 1s linear infinite; }
  .pulse { fill: #3fb950; animation: travel 1.8s ease-in-out infinite; opacity: 0; }

  .blk { animation: rise .7s ease-out both; }
  .type { fill: #161b22; transform-box: fill-box; transform-origin: right; transform: scaleX(0); animation: type 1.2s steps(14) both; }

  .mining { stroke: #d29922; stroke-dasharray: 8 5; animation: march 1s linear infinite, mineBorder 6s ease-in-out infinite; }
  .found { fill: none; stroke: #3fb950; stroke-width: 2; opacity: 0; animation: glow 6s ease-in-out infinite; }
  .mine { animation: mineShow 6s ease-in-out infinite; }
  .ok { opacity: 0; animation: glow 6s ease-in-out infinite; }
  .okt { fill: #3fb950; font-size: 13px; font-weight: 700; }
  .pick { fill: #d29922; }
  .nonce { opacity: 0; animation: flick 1.2s steps(1) infinite both; }
  .barbg { fill: #21262d; }
  .bar { fill: #d29922; transform-box: fill-box; transform-origin: left; animation: progress 6s ease-in-out infinite; }

  @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes type { from { transform: scaleX(1); } to { transform: scaleX(0); } }
  @keyframes flow { to { stroke-dashoffset: -14; } }
  @keyframes travel { 0% { transform: translateX(0); opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { transform: translateX(${GAP}px); opacity: 0; } }
  @keyframes march { to { stroke-dashoffset: -26; } }
  @keyframes flick { 0% { opacity: 1; } 12.5% { opacity: 0; } 100% { opacity: 0; } }
  @keyframes progress { 0% { transform: scaleX(0); } 78% { transform: scaleX(1); } 100% { transform: scaleX(1); } }
  @keyframes mineShow { 0%, 78% { opacity: 1; } 82%, 96% { opacity: 0; } 100% { opacity: 1; } }
  @keyframes glow { 0%, 78% { opacity: 0; } 82%, 94% { opacity: 1; } 100% { opacity: 0; } }
  @keyframes mineBorder { 0%, 78% { stroke-opacity: 1; } 82%, 96% { stroke-opacity: 0; } 100% { stroke-opacity: 1; } }

  @media (prefers-reduced-motion: reduce) {
    .blk, .type, .link, .pulse, .mining, .nonce, .bar, .mine, .ok, .found { animation: none !important; }
    .blk { opacity: 1; } .type { display: none; } .n0 { opacity: 1; }
  }
</style>
<rect class="bg" width="${W}" height="${H}" rx="12"/>
${Array.from({ length: 23 }, (_, i) => `<line class="grid" x1="${i * 44}" x2="${i * 44}" y1="0" y2="${H}"/>`).join("")}
<text x="${X0 + 4}" y="34" class="title">⛓ COMMIT CHAIN</text>
<text x="${W - X0 - 4}" y="34" class="sub" text-anchor="end">network: github · validator: @${esc(USER)} · consensus: proof-of-code</text>
${links}${blockSvg}${mining}
<line x1="${X0}" x2="${W - X0}" y1="${H - 52}" y2="${H - 52}" class="sep"/>
<text x="${X0 + 4}" y="${H - 26}" class="stat">blocks mined <tspan class="n">${total.toLocaleString("en-US")}</tspan>   ·   repos <tspan class="n">${repos}</tspan>   ·   last block <tspan class="n">${latest.date}</tspan></text>
<text x="${W - X0 - 4}" y="${H - 26}" class="sub" text-anchor="end">synced ${updated}</text>
</svg>
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
