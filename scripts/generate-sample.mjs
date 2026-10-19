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
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eef6fb"/>
      <stop offset="1" stop-color="#f8f3e8"/>
    </linearGradient>
    <linearGradient id="carrot" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#d85a0a"/>
      <stop offset="0.45" stop-color="#ff9f1c"/>
      <stop offset="1" stop-color="#e86a16"/>
    </linearGradient>
    <linearGradient id="leaf" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#78c94a"/>
      <stop offset="1" stop-color="#2f7d1e"/>
    </linearGradient>
  </defs>

  <rect width="640" height="480" fill="url(#bg)"/>
  <ellipse cx="320" cy="438" rx="150" ry="24" fill="#000000" opacity="0.12"/>

  <g stroke-linecap="round" stroke-linejoin="round">
    <path d="M310 185 C270 135 225 105 185 75 C230 92 275 127 300 180 Z" fill="url(#leaf)"/>
    <path d="M320 185 C320 125 322 80 330 38 C345 88 345 140 334 184 Z" fill="url(#leaf)"/>
    <path d="M334 185 C375 135 420 105 462 75 C415 92 370 128 344 180 Z" fill="url(#leaf)"/>
    <path d="M288 180 C260 145 236 125 210 108 C242 120 272 142 296 176 Z" fill="#56a532"/>
    <path d="M348 180 C378 148 404 128 432 112 C400 122 370 143 344 176 Z" fill="#56a532"/>
    <path d="M320 186 C316 145 312 112 304 86 C322 112 330 146 330 184 Z" fill="#2f7d1e" opacity="0.55"/>
    <path d="M310 186 C286 154 260 132 234 116 C264 128 292 152 318 182 Z" fill="#2f7d1e" opacity="0.45"/>
    <path d="M334 186 C360 156 386 136 414 120 C384 130 356 153 328 182 Z" fill="#2f7d1e" opacity="0.45"/>
  </g>

  <path
    d="M265 170 Q320 145 375 170 L390 205 Q360 315 330 425 Q320 445 310 425 Q280 315 250 205 Z"
    fill="url(#carrot)"
    stroke="#b94a08"
    stroke-width="3"
  />

  <path
    d="M286 184 Q310 174 334 184 Q310 290 312 386 Q296 292 286 184 Z"
    fill="#ffc04d"
    opacity="0.55"
  />

  <g fill="none" stroke="#a84005" stroke-width="3" stroke-linecap="round" opacity="0.45">
    <path d="M272 236 Q320 250 366 232"/>
    <path d="M280 280 Q320 294 356 276"/>
    <path d="M290 324 Q320 334 344 320"/>
    <path d="M300 366 Q320 374 334 362"/>
  </g>

  <g fill="none" stroke="#ffd38a" stroke-width="2" stroke-linecap="round" opacity="0.55">
    <path d="M292 210 Q314 202 336 210"/>
    <path d="M300 252 Q320 260 340 250"/>
    <path d="M306 300 Q320 306 330 298"/>
  </g>
</svg>
`;

await sharp(Buffer.from(svg))
  .jpeg({ quality: 90, mozjpeg: true })
  .toFile(outputFile);

console.log(`ニンジンのサンプルを生成しました: ${outputFile}`);
