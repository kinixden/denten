import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, '..', 'public', 'samples');
const outputFile = path.join(outputDir, 'sample.jpg');

await fs.mkdir(outputDir, { recursive: true });

const svg = `
<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg">
  <rect width="640" height="480" fill="#b9e3ff"/>
  <circle cx="520" cy="86" r="46" fill="#ffd166"/>
  <path d="M0 340 L180 170 L330 340 Z" fill="#6aa84f"/>
  <path d="M240 340 L430 190 L640 340 Z" fill="#38761d"/>
  <rect y="340" width="640" height="140" fill="#8fce6b"/>
  <path d="M0 400 Q160 360 320 400 T640 400 L640 480 L0 480 Z" fill="#4f8f3a"/>
  <text x="24" y="48" font-family="sans-serif" font-size="28" fill="#204060">denten sample</text>
</svg>
`;

await sharp(Buffer.from(svg))
  .jpeg({ quality: 90 })
  .toFile(outputFile);

console.log(`生成しました: ${outputFile}`);
