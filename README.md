# denten

写真を読み込み、写っている品目の候補と割合（%）を日本語で表示するウェブサイトです。Jev（TypeSafe の判断 API）の choice 質問が返す `probabilities` を割合として使います。

## 構成

- Node.js 20+
- Express / Multer / Sharp
- フロントは静的 HTML/CSS/JavaScript
- 画像はサーバーで EXIF の向き補正・リサイズ・JPEG 変換をしてから Jev に送信します。

## 起動方法

1. 依存をインストールします。

   ```bash
   cd /workspace
   npm install
   ```

2. テスト用サンプル画像を生成します。

   ```bash
   npm run generate:sample
   ```

   `public/samples/sample.jpg`（640×480 のニンジンの JPEG）が生成されます。

3. TypeSafe Jev API のキーを環境変数 `Jev_API` に設定します。値は絶対にコミットしないでください。

   ```bash
   export Jev_API="ここに実際のAPIキー"
   ```

   PowerShell の場合:

   ```powershell
   $env:Jev_API="ここに実際のAPIキー"
   ```

4. サーバを起動します。

   ```bash
   npm start
   ```

5. ブラウザで `http://127.0.0.1:3000` を開きます。

## 環境変数

- `Jev_API`: TypeSafe Jev API の Bearer トークン。サーバー側だけで読み、クライアントには返しません。
- `TYPESAFE_API_KEY` は使いません。

## 画像の制限

- PNG または JPEG の静止画のみ利用できます。
- WebP / GIF / HEIC / アニメーション PNG はエラーになります。
- アップロード上限は 25 MiB です。
- Jev に送る前に、各辺 280〜1568 px、16 MiB 以下になるようサーバーで調整します。
- 極端な縦横比の画像は、Jev の制限に収まるよう中央でクロップします。

## 判定内容

- 写真に写っている主な品目を choice 質問で判定します。
- 候補ごとの割合は Jev の `probabilities` を % に変換し、高い順に表示します。
- 最も高い候補を画面上部に大きく表示します。
- 屋外かどうか、明るさは主結果としては表示しません。

## 注意

- API キーはコード、README、ブラウザ、ログ、エラー画面に出しません。
- `Jev_API` が未設定の場合、画面には設定不足の日本語メッセージが表示されます。
