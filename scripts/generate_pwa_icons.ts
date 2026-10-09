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
}

generatePwaIcons().catch((err) => {
  console.error('Error generating PWA icons:', err);
  process.exit(1);
});
