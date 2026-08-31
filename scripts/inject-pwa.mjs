// Add PWA metadata to Expo's generated single-page HTML and pre-cache the
// exported app shell. Run after `expo export -p web` via `npm run web:build`.
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const INDEX = join(DIST, 'index.html');
const SERVICE_WORKER = join(DIST, 'sw.js');

if (!existsSync(INDEX) || !existsSync(SERVICE_WORKER)) {
  console.error('inject-pwa: dist output is incomplete; run `expo export -p web` first.');
  process.exit(1);
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

const files = listFiles(DIST)
  .filter((path) => path !== SERVICE_WORKER && !path.endsWith('.map'))
  .sort();
const precache = files.map((path) => {
  if (path === INDEX) return '/';
  return `/${relative(DIST, path).split(sep).join('/')}`;
});
const buildId = createHash('sha256')
  .update(files.map((path) => `${relative(DIST, path)}:${statSync(path).size}`).join('|'))
  .digest('hex')
  .slice(0, 12);

let serviceWorker = readFileSync(SERVICE_WORKER, 'utf8');
serviceWorker = serviceWorker
  .replace("const CACHE = 'vora-shell-dev';", `const CACHE = 'vora-shell-${buildId}';`)
  .replace(
    "const PRECACHE = ['/', '/manifest.json'];",
    `const PRECACHE = ${JSON.stringify(precache, null, 2)};`,
  );
writeFileSync(SERVICE_WORKER, serviceWorker);

let html = readFileSync(INDEX, 'utf8');
html = html.replace(
  /(<meta name="viewport" content=")([^"]*)(")/i,
  (_match, before, content, after) =>
    before + (content.includes('viewport-fit') ? content : `${content}, viewport-fit=cover`) + after,
);

if (!html.includes('rel="manifest"')) {
  const tags = `
    <link rel="manifest" href="/manifest.json" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="V.O.R.A." />
    <script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}</script>
  `;
  html = html.replace('</head>', `${tags}</head>`);
  writeFileSync(INDEX, html);
}

console.log(`inject-pwa: prepared ${precache.length} shell assets (${buildId}).`);
