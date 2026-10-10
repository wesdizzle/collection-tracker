import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

async function generatePwaIcons() {
  const svgPath = path.resolve('public/favicon.svg');
  const svgBuffer = fs.readFileSync(svgPath);

  const outDir = path.resolve('public/icons');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 1. Standard 192x192 PNG
  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile(path.join(outDir, 'icon-192.png'));
  console.log('Generated public/icons/icon-192.png');

  // 2. Standard 512x512 PNG
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(outDir, 'icon-512.png'));
  console.log('Generated public/icons/icon-512.png');

  // 3. Apple Touch Icon 180x180 PNG
  await sharp(svgBuffer)
    .resize(180, 180)
    .png()
    .toFile(path.join(outDir, 'apple-touch-icon.png'));
  console.log('Generated public/icons/apple-touch-icon.png');

  // 4. Maskable 512x512 (with safe area padding ~10%)
  const iconResized = await sharp(svgBuffer).resize(410, 410).toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 18, g: 18, b: 20, alpha: 1 }, // #121214 dark background
    },
  })
    .composite([{ input: iconResized, gravity: 'center' }])
    .png()
    .toFile(path.join(outDir, 'icon-maskable-512.png'));
  console.log('Generated public/icons/icon-maskable-512.png');

  // 5. Android Notification Badges (Monochrome white outline on transparent background)
  const badgeSvgPath = path.resolve('public/badge.svg');
  const badgeSvgBuffer = fs.existsSync(badgeSvgPath)
    ? fs.readFileSync(badgeSvgPath)
    : svgBuffer;

  await sharp(badgeSvgBuffer)
    .resize(96, 96)
    .png()
    .toFile(path.join(outDir, 'badge-96.png'));
  console.log('Generated public/icons/badge-96.png');

  await sharp(badgeSvgBuffer)
    .resize(72, 72)
    .png()
    .toFile(path.join(outDir, 'badge-72.png'));
  console.log('Generated public/icons/badge-72.png');

  await sharp(badgeSvgBuffer)
    .resize(96, 96)
    .png()
    .toFile(path.join(outDir, 'badge.png'));
  console.log('Generated public/icons/badge.png');

  // Sync to dist if dist build exists
  const distIconsDir = path.resolve('dist/tracker/browser/icons');
  if (fs.existsSync(distIconsDir)) {
    for (const file of [
      'icon-192.png',
      'icon-512.png',
      'apple-touch-icon.png',
      'icon-maskable-512.png',
      'badge-96.png',
      'badge-72.png',
      'badge.png',
    ]) {
      fs.copyFileSync(path.join(outDir, file), path.join(distIconsDir, file));
    }
    const distFavicon = path.resolve('dist/tracker/browser/favicon.svg');
    if (fs.existsSync(path.dirname(distFavicon))) {
      fs.copyFileSync(svgPath, distFavicon);
    }
    const distBadge = path.resolve('dist/tracker/browser/badge.svg');
    if (fs.existsSync(badgeSvgPath) && fs.existsSync(path.dirname(distBadge))) {
      fs.copyFileSync(badgeSvgPath, distBadge);
    }
  }
}

generatePwaIcons().catch((err) => {
  console.error('Error generating PWA icons:', err);
  process.exit(1);
});
