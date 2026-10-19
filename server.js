import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const SAMPLE_PATH = path.join(PUBLIC_DIR, 'samples', 'sample.jpg');

const HOST = '127.0.0.1';
const PORT = 3000;

const API_URL = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const API_IMAGE_PART = 'photo';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MIN_SIDE = 280;
const MAX_SIDE = 1568;
const MIN_PIXELS = 78400;
const MAX_PIXELS = 2458624;

const ALLOWED_FORMATS = new Set(['jpeg', 'png']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

const QUESTION_DEFS = [
  {
    id: 'subject',
    title: 'この画像は主に何を写した写真ですか？',
    type: 'choice',
    body: {
      type: 'choice',
      instructions: '画像全体を見て、最も当てはまるものを1つ選んでください。',
      criteria: {
        '人': '人物、顔、体、集団などが主な被写体です。',
        '動物': '犬、猫、鳥、野生動物などが主な被写体です。',
        '風景': '山、海、空、森、街並みなど自然や景色が主な被写体です。',
        '食べ物': '料理、飲み物、食材などが主な被写体です。',
        '建物・室内': '建物、部屋、家具、設備などが主な被写体です。',
        'その他': '上記のどれにも強く当てはまりません。'
      }
    }
  },
  {
    id: 'outdoor',
    title: '屋外で撮影された写真ですか？',
    type: 'noul',
    body: {
      type: 'noul',
      instructions: '画像に写っている場所が屋外か、屋内かを判断してください。',
      criteria: {
        true: '空、自然光、屋外の風景や建物の外観が見えます。',
        false: '室内、壁、天井、人工照明などが見えます。'
      }
    }
  },
  {
    id: 'brightness',
    title: 'この画像の明るさはどのくらいですか？',
    type: 'score',
    body: {
      type: 'score',
      instructions: '画像全体の明るさを、暗い順に並んだ尺度で評価してください。',
      criteria: [
        '非常に暗い',
        '暗い',
        'やや暗い',
        '普通',
        'やや明るい',
        '明るい',
        '非常に明るい'
      ]
    }
  }
];

const app = express();
app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1
  }
});

function hasPngActl(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return false;

  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(pngSignature)) return false;

  let offset = 8;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);

    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') break;

    const nextOffset = offset + 12 + length;
    if (nextOffset <= offset || nextOffset > buffer.length) break;
    offset = nextOffset;
  }

  return false;
}

function buildApiRequest(ref) {
  const questions = {};

  for (const question of QUESTION_DEFS) {
    questions[question.id] = question.body;
  }

  return {
    model: MODEL,
    state: {
      [API_IMAGE_PART]: ref
    },
    questions,
    assets: {
      [ref]: {
        type: 'image',
        part: API_IMAGE_PART
      }
    }
  };
}

async function normalizeImage(inputBuffer) {
  let metadata;

  try {
    metadata = await sharp(inputBuffer, { limitInputPixels: 100_000_000 }).metadata();
  } catch {
    throw new HttpError(
      415,
      '画像ファイルを読み取れませんでした。PNG または JPEG を選んでください。'
    );
  }

  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw new HttpError(
      415,
      'この画像形式は利用できません。PNG または JPEG を選んでください。'
    );
  }

  if (metadata.pages && metadata.pages > 1) {
    throw new HttpError(
      415,
      'アニメーション画像は利用できません。静止画の PNG または JPEG を選んでください。'
    );
  }

  if (metadata.format === 'png' && hasPngActl(inputBuffer)) {
    throw new HttpError(
      415,
      'アニメーション PNG は利用できません。静止画の PNG または JPEG を選んでください。'
    );
  }

  let normalized;

  try {
    normalized = await sharp(inputBuffer, { limitInputPixels: 100_000_000 })
      .rotate()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new HttpError(
      415,
      '画像の向きを正せませんでした。別の PNG または JPEG を選んでください。'
    );
  }

  const width = normalized.info.width;
  const height = normalized.info.height;

  if (!width || !height) {
    throw new HttpError(415, '画像のサイズを取得できませんでした。');
  }

  const maxAspect = MAX_SIDE / MIN_SIDE;
  const minAspect = MIN_SIDE / MAX_SIDE;

  let crop = {
    left: 0,
    top: 0,
    width,
    height
  };

  if (width / height > maxAspect) {
    const croppedWidth = Math.max(1, Math.floor(height * maxAspect));
    crop = {
      left: Math.floor((width - croppedWidth) / 2),
      top: 0,
      width: croppedWidth,
      height
    };
  } else if (width / height < minAspect) {
    const croppedHeight = Math.max(1, Math.floor(width * maxAspect));
    crop = {
      left: 0,
      top: Math.floor((height - croppedHeight) / 2),
      width,
      height: croppedHeight
    };
  }

  let targetWidth = crop.width;
  let targetHeight = crop.height;

  const maxSide = Math.max(targetWidth, targetHeight);
  const minSide = Math.min(targetWidth, targetHeight);

  if (maxSide > MAX_SIDE) {
    const scale = MAX_SIDE / maxSide;
    targetWidth = Math.max(1, Math.round(targetWidth * scale));
    targetHeight = Math.max(1, Math.round(targetHeight * scale));
  } else if (minSide < MIN_SIDE) {
    const scale = MIN_SIDE / minSide;
    targetWidth = Math.max(1, Math.round(targetWidth * scale));
    targetHeight = Math.max(1, Math.round(targetHeight * scale));
  }

  targetWidth = Math.max(MIN_SIDE, Math.min(MAX_SIDE, targetWidth));
  targetHeight = Math.max(MIN_SIDE, Math.min(MAX_SIDE, targetHeight));

  const pixels = targetWidth * targetHeight;

  if (pixels < MIN_PIXELS || pixels > MAX_PIXELS) {
    throw new HttpError(
      400,
      '画像の縦横比またはサイズが Jev の制限に合いません。別の画像を選んでください。'
    );
  }

  const base = sharp(normalized.data)
    .flatten({ background: '#ffffff' })
    .extract({
      left: crop.left,
      top: crop.top,
      width: crop.width,
      height: crop.height
    })
    .resize(targetWidth, targetHeight, { fit: 'fill' });

  let output = null;

  for (let quality = 88; quality >= 40; quality -= 8) {
    output = await base.clone().jpeg({ quality, mozjpeg: true }).toBuffer();

    if (output.length <= MAX_IMAGE_BYTES) {
      break;
    }
  }

  if (!output || output.length > MAX_IMAGE_BYTES) {
    throw new HttpError(
      413,
      '画像を 16 MiB 以下にできませんでした。より小さい画像を選んでください。'
    );
  }

  return {
    buffer: output,
    width: targetWidth,
    height: targetHeight,
    format: 'JPEG',
    bytes: output.length
  };
}

function messageForStatus(status) {
  switch (status) {
    case 400:
      return '画像または質問の形式が正しくありません。別の画像でお試しください。';
    case 401:
      return 'Jev の認証に失敗しました。サーバーの認証設定を確認してください。';
    case 413:
      return '画像またはリクエストが大きすぎます。より小さい画像を選んでください。';
    case 415:
      return 'この画像形式は Jev では利用できません。PNG または JPEG を選んでください。';
    case 422:
      return 'Jev がリクエストを処理できませんでした。画像の内容やサイズを変えてお試しください。';
    case 429:
      return 'Jev の利用回数制限に達しました。しばらく待ってからお試しください。';
    case 529:
      return 'Jev が混雑しています。しばらく待ってからお試しください。';
    default:
      return `Jev の呼び出しに失敗しました（HTTP ${status}）。`;
  }
}

async function callJev(image, ref) {
  const apiKey = process.env.Jev_API;

  if (!apiKey) {
    throw new HttpError(
      500,
      'サーバーに判断 API の認証情報が設定されていません。管理者に連絡してください。'
    );
  }

  const requestBody = buildApiRequest(ref);
  const form = new FormData();

  form.append(
    'request',
    new Blob([JSON.stringify(requestBody)], { type: 'application/json' }),
    'request.json'
  );

  form.append(
    API_IMAGE_PART,
    new Blob([image.buffer], { type: 'image/jpeg' }),
    'image.jpg'
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  let response;

  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'TypeSafe-Danger-Zone-Images': 'true',
        Accept: 'application/json'
      },
      body: form,
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new HttpError(
        504,
        'Jev の応答がタイムアウトしました。もう一度お試しください。'
      );
    }

    throw new HttpError(
      502,
      'Jev に接続できませんでした。ネットワークを確認してください。'
    );
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    console.error(`Jev API error: HTTP ${response.status}`);
    throw new HttpError(response.status, messageForStatus(response.status));
  }

  if (!data || typeof data !== 'object') {
    throw new HttpError(502, 'Jev から解釈できない応答が返りました。');
  }

  return data;
}

function formatPercent(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return '不明';

  return `${Math.round(number * 1000) / 10}%`;
}

function getLegendEntries(legend) {
  if (!legend || typeof legend !== 'object' || Array.isArray(legend)) {
    return [];
  }

  return Object.entries(legend)
    .map(([key, label]) => ({
      level: Number(key),
      label: String(label)
    }))
    .filter((entry) => Number.isFinite(entry.level));
}

function labelForScore(score, legend, fallbackCriteria) {
  let entries = getLegendEntries(legend);

  if (entries.length === 0 && Array.isArray(fallbackCriteria)) {
    entries = fallbackCriteria.map((label, index) => ({
      level: index,
      label: String(label)
    }));
  }

  if (entries.length === 0) return null;

  let nearest = entries[0];

  for (const entry of entries) {
    if (
      Math.abs(entry.level - score) <
      Math.abs(nearest.level - score)
    ) {
      nearest = entry;
    }
  }

  return nearest.label;
}

function probabilityLabel(key, legend) {
  if (legend && typeof legend === 'object' && !Array.isArray(legend)) {
    const value = legend[key];

    if (value != null) return String(value);
  }

  return String(key);
}

function formatAnswer(def, answer) {
  const details = [];

  if (!answer || typeof answer !== 'object') {
    return {
      headline: '回答を取得できませんでした。',
      details
    };
  }

  if (typeof answer.confidence === 'number') {
    details.push(`信頼度: ${formatPercent(answer.confidence)}`);
  }

  if (
    answer.probabilities &&
    typeof answer.probabilities === 'object' &&
    !Array.isArray(answer.probabilities)
  ) {
    const entries = Object.entries(answer.probabilities)
      .map(([key, value]) => [key, Number(value)])
      .filter(([, value]) => Number.isFinite(value))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (entries.length > 0) {
      details.push(
        `確率: ${entries
          .map(
            ([key, value]) =>
              `${probabilityLabel(key, answer.legend)} ${formatPercent(value)}`
          )
          .join(' / ')}`
      );
    }
  }

  if (def.type === 'noul') {
    const probability = Number(answer.noul);

    if (!Number.isFinite(probability)) {
      return {
        headline: '回答形式を解釈できませんでした。',
        details
      };
    }

    const yes = probability >= 0.5;
    const confidence = yes ? probability : 1 - probability;

    return {
      headline: `${yes ? 'はい' : 'いいえ'}（確率 ${formatPercent(confidence)}）`,
      details
    };
  }

  if (def.type === 'choice') {
    const choice = answer.choice == null ? '不明' : String(answer.choice);
    const probability = Number(answer.probabilities?.[answer.choice]);
    const suffix = Number.isFinite(probability)
      ? `（確率 ${formatPercent(probability)}）`
      : '';

    return {
      headline: `選択: ${choice}${suffix}`,
      details
    };
  }

  if (def.type === 'score') {
    const score = Number(answer.score);

    if (!Number.isFinite(score)) {
      return {
        headline: '回答形式を解釈できませんでした。',
        details
      };
    }

    const label = labelForScore(score, answer.legend, def.body?.criteria);

    return {
      headline: label ? `スコア: ${score}（${label}）` : `スコア: ${score}`,
      details
    };
  }

  return {
    headline: '回答を表示できませんでした。',
    details
  };
}

function normalizeAnswers(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const answerMap = data.answers;

  if (!answerMap || typeof answerMap !== 'object' || Array.isArray(answerMap)) {
    return null;
  }

  const hasKnownAnswer = QUESTION_DEFS.some(
    (def) => answerMap[def.id] != null
  );

  if (!hasKnownAnswer) {
    return null;
  }

  return QUESTION_DEFS.map((def) => {
    const answer = answerMap[def.id] ?? null;

    return {
      id: def.id,
      title: def.title,
      type: def.type,
      answer,
      display: formatAnswer(def, answer)
    };
  });
}

app.post('/api/judge', upload.single('image'), async (req, res, next) => {
  try {
    let inputBuffer = null;
    let source = null;

    if (req.file) {
      inputBuffer = req.file.buffer;
      source = 'upload';
    } else if (req.body?.sample === 'sample') {
      try {
        inputBuffer = await fs.readFile(SAMPLE_PATH);
        source = 'sample';
      } catch {
        throw new HttpError(
          500,
          'サンプル画像が見つかりません。管理者に連絡してください。'
        );
      }
    } else {
      throw new HttpError(
        400,
        '画像ファイルを選ぶか、サンプル画像を選択してください。'
      );
    }

    const image = await normalizeImage(inputBuffer);
    const ref = crypto.randomUUID();
    const data = await callJev(image, ref);
    const answers = normalizeAnswers(data);

    res.json({
      ok: true,
      model: MODEL,
      image: {
        width: image.width,
        height: image.height,
        format: image.format,
        bytes: image.bytes,
        source
      },
      answers,
      raw: answers ? undefined : data
    });
  } catch (error) {
    next(error);
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        ok: false,
        error: '画像ファイルが大きすぎます。25 MiB 以下の画像を選んでください。'
      });
    }

    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        ok: false,
        error: '画像は1枚だけアップロードできます。'
      });
    }

    return res.status(400).json({
      ok: false,
      error: '画像のアップロードに失敗しました。'
    });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({
      ok: false,
      error: err.message
    });
  }

  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({
    ok: false,
    error: 'サーバーで予期しないエラーが発生しました。'
  });
});

app.listen(PORT, HOST, () => {
  console.log(`denten: http://${HOST}:${PORT}`);
});
