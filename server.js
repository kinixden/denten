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
const QUESTION_ID = 'item';

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

const ITEM_CRITERIA = {
  'ニンジン': 'オレンジ色の細長い根菜。青々とした葉が付くことが多い。',
  '大根': '白く太い根菜。緑色の葉が付くことが多い。',
  'カブ': '白い小さめの根菜。丸い形や長い形があり、葉が付く。',
  'ゴボウ': '茶色く細長い根菜。土の色に近く、長い棒状。',
  'レンコン': '茶色の穴が並ぶ断面を持つ根菜。節のある筒状。',
  'ジャガイモ': '茶色や薄い黄色のいも。丸みのある不定形。',
  'サツマイモ': '赤紫や茶色の皮の細長いいも。中は黄色や橙色。',
  'サトイモ': '茶色の皮と白い中身を持つ、丸みのあるいも。',
  'タマネギ': '紫や茶色の薄皮に包まれた球状の野菜。',
  'ネギ': '白い根元と緑の長い葉を持つ細長い野菜。',
  'キャベツ': '緑色の葉が重なった球状の野菜。',
  'レタス': '薄い緑色の葉が重なった葉物野菜。',
  'ホウレン草': '濃い緑色の葉と茎を持つ葉物野菜。',
  'ブロッコリー': '緑色のつぼみが集まったこんもりした野菜。',
  'トマト': '赤や橙色の丸い果菜。ヘタが付くことが多い。',
  'ナス': '紫や黒紫色の光沢がある細長い果菜。',
  'キュウリ': '緑色で細長く、いぼのある果菜。',
  'ピーマン': '緑色で光沢のある空洞の果菜。',
  'カボチャ': '橙や濃い緑色の硬い皮を持つ大型の果菜。',
  'オクラ': '緑色で細長く、先が尖った果菜。',
  'アスパラガス': '緑色の細長い茎と先端の芽を持つ野菜。',
  'トウモロコシ': '黄色い粒が並ぶ穂と緑の皮を持つ作物。',
  'シイタケ': '茶色い傘と白い軸を持つきのこ。',
  'リンゴ': '赤や黄緑色の丸い果物。',
  'バナナ': '黄色く細長い果物。',
  'レモン': '黄色く楕円形の柑橘系果物。',
  'その他の野菜': '上記の野菜に当てはまらない野菜。',
  'その他の果物': '上記の果物に当てはまらない果物。',
  '食品以外': '食べ物ではない物、または食品と判断できない物。',
  '判別不能': '画像が暗い、ぼやけているなど、品目を判別できない。'
};

const QUESTION_DEFS = [
  {
    id: QUESTION_ID,
    title: '写真に写っている主な品目は何ですか？',
    type: 'choice',
    body: {
      type: 'choice',
      instructions:
        '写真全体を見て、最も目立つ品目を1つ選んでください。複数写っている場合は、主なものを選んでください。',
      criteria: ITEM_CRITERIA
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
  const question = QUESTION_DEFS[0];

  return {
    model: MODEL,
    state: {
      [API_IMAGE_PART]: ref
    },
    assets: {
      [ref]: {
        type: 'image',
        part: API_IMAGE_PART
      }
    },
    questions: {
      [question.id]: question.body
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
      'サーバーに判定 API の認証情報が設定されていません。管理者に連絡してください。'
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

function clampProbability(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return null;

  return Math.max(0, Math.min(1, number));
}

function toPercent(probability) {
  const clamped = clampProbability(probability);

  if (clamped == null) return null;

  return Math.round(clamped * 1000) / 10;
}

function normalizeItemResult(data) {
  const answerMap =
    data &&
    typeof data === 'object' &&
    data.answers &&
    typeof data.answers === 'object' &&
    !Array.isArray(data.answers)
      ? data.answers
      : null;

  const answer =
    answerMap && typeof answerMap === 'object' ? answerMap[QUESTION_ID] : null;

  if (!answer || typeof answer !== 'object') {
    return null;
  }

  let candidates = [];

  if (
    answer.probabilities &&
    typeof answer.probabilities === 'object' &&
    !Array.isArray(answer.probabilities)
  ) {
    candidates = Object.entries(answer.probabilities)
      .map(([label, value]) => {
        const probability = clampProbability(value);

        return probability == null
          ? null
          : { label: String(label), probability };
      })
      .filter(Boolean);
  }

  if (candidates.length === 0 && answer.choice != null) {
    const probability = clampProbability(answer.confidence);

    candidates.push({
      label: String(answer.choice),
      probability: probability == null ? 1 : probability
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    if (b.probability !== a.probability) {
      return b.probability - a.probability;
    }

    return a.label.localeCompare(b.label, 'ja');
  });

  const top = candidates[0];

  return {
    top: {
      label: top.label,
      probability: top.probability,
      percent: toPercent(top.probability)
    },
    candidates: candidates.map((candidate, index) => ({
      rank: index + 1,
      label: candidate.label,
      probability: candidate.probability,
      percent: toPercent(candidate.probability)
    })),
    confidence: clampProbability(answer.confidence)
  };
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
    const result = normalizeItemResult(data);

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
      result,
      raw: result ? undefined : data
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
