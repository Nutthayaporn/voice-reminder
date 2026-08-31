// Generate installable PWA icons which match V.O.R.A.'s dark HUD theme.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
mkdirSync(PUBLIC, { recursive: true });

const svg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="70%">
      <stop offset="0" stop-color="#0A2A36"/>
      <stop offset="1" stop-color="#02070C"/>
    </radialGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="16" result="blur"/></filter>
  </defs>
  <rect width="1024" height="1024" rx="210" fill="url(#bg)"/>
  <circle cx="512" cy="512" r="300" fill="none" stroke="#44F1FF" stroke-width="14" opacity="0.24" filter="url(#glow)"/>
  <circle cx="512" cy="512" r="282" fill="#06121A" stroke="#44F1FF" stroke-width="12"/>
  <circle cx="512" cy="512" r="230" fill="none" stroke="#1D697C" stroke-width="5" stroke-dasharray="18 15"/>
  <path d="M332 332 L512 716 L692 332" fill="none" stroke="#C5FCFF" stroke-width="76" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="512" cy="760" r="20" fill="#57F2B1"/>
</svg>`;

const targets = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

for (const target of targets) {
  await sharp(Buffer.from(svg)).resize(target.size, target.size).png().toFile(join(PUBLIC, target.name));
}

console.log(`gen-web-icons: wrote ${targets.map((target) => target.name).join(', ')}.`);
