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
const answers = document.getElementById('answers');
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
  submitButton.textContent = isLoading ? '判断中…' : '判断する';
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

  answers.replaceChildren();

  if (Array.isArray(data.answers) && data.answers.length > 0) {
    for (const item of data.answers) {
      const card = document.createElement('article');
      card.className = 'answer-card';

      const title = document.createElement('h3');
      title.textContent = item.title || '質問';

      const headline = document.createElement('p');
      headline.className = 'answer-headline';
      headline.textContent = item.display?.headline || '回答を表示できませんでした。';

      card.append(title, headline);

      const details = item.display?.details;

      if (Array.isArray(details) && details.length > 0) {
        const list = document.createElement('ul');
        list.className = 'answer-details';

        for (const detail of details) {
          const listItem = document.createElement('li');
          listItem.textContent = detail;
          list.append(listItem);
        }

        card.append(list);
      }

      answers.append(card);
    }
  } else {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent =
      'Jev から解釈できる回答が返りませんでした。下の生データを確認してください。';
    answers.append(empty);
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
  setStatus('Jev が画像を判断しています…');

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
        data.error || `判断に失敗しました（HTTP ${response.status}）。`
      );
    }

    renderResult(data);
    setStatus('判断が完了しました。');
  } catch (error) {
    showError(
      error instanceof Error ? error.message : '通信に失敗しました。'
    );
    setStatus('');
  } finally {
    setLoading(false);
  }
});
