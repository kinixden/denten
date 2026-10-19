const form = document.getElementById('judgeForm');
const sourceRadios = Array.from(document.querySelectorAll('input[name="source"]'));
const uploadArea = document.getElementById('uploadArea');
const sampleArea = document.getElementById('sampleArea');
const imageInput = document.getElementById('imageInput');
const submitButton = document.getElementById('submitButton');
const statusText = document.getElementById('status');
const errorBox = document.getElementById('errorBox');
const resultSection = document.getElementById('resultSection');
const imageInfo = document.getElementById('imageInfo');
const topResult = document.getElementById('topResult');
const topName = document.getElementById('topName');
const topPercent = document.getElementById('topPercent');
const candidatesTitle = document.getElementById('candidatesTitle');
const candidateList = document.getElementById('candidateList');
const emptyResult = document.getElementById('emptyResult');
const rawDetails = document.getElementById('rawDetails');
const rawPre = document.getElementById('rawPre');

function selectedSource() {
  return document.querySelector('input[name="source"]:checked')?.value ?? 'upload';
}

function updateSourceUI() {
  const isUpload = selectedSource() === 'upload';

  uploadArea.hidden = !isUpload;
  sampleArea.hidden = isUpload;
  imageInput.disabled = !isUpload;
}

function setStatus(message) {
  statusText.textContent = message;
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? '判定中…' : '判定する';
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.textContent = '';
  errorBox.hidden = true;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function formatPercent(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return '不明';
  }

  return `${number.toFixed(1)}%`;
}

function renderCandidates(result) {
  topResult.hidden = false;
  topName.textContent = result.top?.label ?? '不明';
  topPercent.textContent = formatPercent(result.top?.percent);

  const candidates = Array.isArray(result.candidates) ? result.candidates : [];

  candidateList.replaceChildren();

  if (candidates.length === 0) {
    candidatesTitle.hidden = true;
    emptyResult.hidden = false;
    emptyResult.textContent = '候補の割合を取得できませんでした。';
    return;
  }

  candidatesTitle.hidden = false;
  emptyResult.hidden = true;
  emptyResult.textContent = '';

  for (const candidate of candidates) {
    const item = document.createElement('li');
    item.className = 'candidate';

    if (candidate.rank === 1) {
      item.classList.add('is-top');
    }

    const head = document.createElement('div');
    head.className = 'candidate-head';

    const label = document.createElement('span');
    label.className = 'candidate-label';
    label.textContent = candidate.label ?? '不明';

    const percent = document.createElement('span');
    percent.className = 'candidate-percent';
    percent.textContent = formatPercent(candidate.percent);

    head.append(label, percent);

    const bar = document.createElement('div');
    bar.className = 'candidate-bar';
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${label.textContent} ${percent.textContent}`);

    const fill = document.createElement('span');
    fill.className = 'candidate-fill';
    const width = Math.max(0, Math.min(100, Number(candidate.percent) || 0));
    fill.style.width = `${width}%`;

    bar.append(fill);
    item.append(head, bar);
    candidateList.append(item);
  }
}

function renderResult(data) {
  resultSection.hidden = false;
  hideError();

  const sourceLabel = data.image?.source === 'sample' ? 'サンプル' : 'アップロード';
  const width = data.image?.width ?? '不明';
  const height = data.image?.height ?? '不明';
  const format = data.image?.format ?? '不明';
  const bytes = formatBytes(data.image?.bytes);

  imageInfo.textContent =
    `画像: ${width}×${height} px / ${format} / ${bytes}（${sourceLabel}）`;

  topResult.hidden = true;
  topName.textContent = '';
  topPercent.textContent = '';
  candidatesTitle.hidden = true;
  candidateList.replaceChildren();
  emptyResult.hidden = true;
  emptyResult.textContent = '';

  if (
    data.result &&
    data.result.top &&
    Array.isArray(data.result.candidates) &&
    data.result.candidates.length > 0
  ) {
    renderCandidates(data.result);
  } else {
    emptyResult.hidden = false;
    emptyResult.textContent =
      'Jev から品目の候補と割合を取得できませんでした。下の生データを確認してください。';
  }

  if (data.raw) {
    rawPre.textContent = JSON.stringify(data.raw, null, 2);
    rawDetails.hidden = false;
  } else {
    rawPre.textContent = '';
    rawDetails.hidden = true;
  }

  resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

sourceRadios.forEach((radio) => {
  radio.addEventListener('change', updateSourceUI);
});

updateSourceUI();
hideError();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideError();
  setStatus('');

  const source = selectedSource();
  const body = new FormData();

  if (source === 'sample') {
    body.append('sample', 'sample');
  } else {
    const file = imageInput.files?.[0];

    if (!file) {
      showError('画像ファイルを選んでください。');
      imageInput.focus();
      return;
    }

    body.append('image', file);
  }

  setLoading(true);
  setStatus('Jev が写真の品目を判定しています…');

  try {
    const response = await fetch('/api/judge', {
      method: 'POST',
      body
    });

    let data = {};

    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok || !data.ok) {
      throw new Error(
        data.error || `判定に失敗しました（HTTP ${response.status}）。`
      );
    }

    renderResult(data);
    setStatus('判定が完了しました。');
  } catch (error) {
    showError(
      error instanceof Error ? error.message : '通信に失敗しました。'
    );
    setStatus('');
  } finally {
    setLoading(false);
  }
});
