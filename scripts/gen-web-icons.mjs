// Generate the complete Expo + PWA icon set from the VORA master mark.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const PUBLIC = join(ROOT, 'public');
const SOURCE = join(ASSETS, 'voice-reminder-logo.png');
const BACKGROUND = '#02070C';

mkdirSync(ASSETS, { recursive: true });
mkdirSync(PUBLIC, { recursive: true });

async function renderIcon(path, size, logoScale = 1) {
  const logoSize = Math.round(size * logoScale);
  const logo = await sharp(SOURCE)
    .resize(logoSize, logoSize, { fit: 'contain' })
    .flatten({ background: BACKGROUND })
    .png()
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(path);
}

async function renderCircularLogo(path, size, logoScale) {
  const logoSize = Math.round(size * logoScale);
  const circleMask = Buffer.from(
    `<svg width="${logoSize}" height="${logoSize}"><circle cx="50%" cy="50%" r="49%" fill="white"/></svg>`,
  );
  const logo = await sharp(SOURCE)
    .resize(logoSize, logoSize, { fit: 'contain' })
    .ensureAlpha()
    .composite([{ input: circleMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: '#00000000' },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(path);
}

async function renderMonochrome(path, size, logoScale) {
  const logoSize = Math.round(size * logoScale);
  const alpha = await sharp(SOURCE)
    .resize(logoSize, logoSize, { fit: 'contain' })
    .greyscale()
    .threshold(72)
    .toBuffer();
  const whiteMark = await sharp({
    create: { width: logoSize, height: logoSize, channels: 3, background: '#FFFFFF' },
  })
    .joinChannel(alpha)
    .png()
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: '#00000000' },
  })
    .composite([{ input: whiteMark, gravity: 'centre' }])
    .png()
    .toFile(path);
}

await Promise.all([
  renderIcon(join(ASSETS, 'icon.png'), 1024),
  renderCircularLogo(join(ASSETS, 'splash-icon.png'), 1024, 0.72),
  renderCircularLogo(join(ASSETS, 'android-icon-foreground.png'), 512, 0.76),
  sharp({
    create: { width: 512, height: 512, channels: 4, background: BACKGROUND },
  }).png().toFile(join(ASSETS, 'android-icon-background.png')),
  renderMonochrome(join(ASSETS, 'android-icon-monochrome.png'), 432, 0.76),
  renderIcon(join(ASSETS, 'favicon.png'), 48, 0.92),
  renderIcon(join(PUBLIC, 'icon-192.png'), 192, 0.92),
  renderIcon(join(PUBLIC, 'icon-512.png'), 512, 0.92),
  renderIcon(join(PUBLIC, 'apple-touch-icon.png'), 180, 0.92),
]);

console.log('gen-web-icons: wrote Expo, Android adaptive, favicon, and PWA icon assets.');
