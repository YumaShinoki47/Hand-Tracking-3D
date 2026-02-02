# ✨ Hand Magic Studio

MediaPipe + Three.js を使用したインタラクティブな3Dハンドトラッキング体験

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Three.js](https://img.shields.io/badge/Three.js-0.160.0-green.svg)
![MediaPipe](https://img.shields.io/badge/MediaPipe-0.10.22-orange.svg)

## 🎯 概要

Hand Magic Studio は、Webカメラで手の動きをトラッキングし、ジェスチャーに応じて魔法のようなパーティクルエフェクトを生成するインタラクティブな3D体験アプリケーションです。

### 特徴

- 🖐️ **リアルタイム手検出** - MediaPipe を使用した高精度な手のトラッキング
- ✨ **魔法のエフェクト** - ジェスチャーに応じた美しいパーティクル効果
- 🎨 **没入感のある3D空間** - Three.js による滑らかな3Dレンダリング
- 🚀 **軽量設計** - ビルド不要、CDN直リンクで動作

## 🎮 ジェスチャー一覧

| ジェスチャー | 絵文字 | エフェクト |
|------------|-------|----------|
| ピンチ | 👌 | パーティクル放出 |
| グー | ✊ | エネルギー球生成 |
| ピース | ✌️ | 虹エフェクト |
| 手を広げる | 🖐️ | 波紋リセット |
| 指差し | 👆 | スパーク |
| ロック | 🤘 | 火花エフェクト |

## 🚀 使い方

### ローカルサーバーで起動

このプロジェクトは ES Modules を使用しているため、ローカルサーバーが必要です。

#### 方法1: Python（推奨）

```bash
cd mediapipe-Three.js
python -m http.server 8080
```

ブラウザで `http://localhost:8080` を開く

#### 方法2: Node.js

```bash
npx serve .
```

#### 方法3: VS Code Live Server

VS Code の Live Server 拡張機能を使用

### 操作方法

1. 「カメラを起動」ボタンをクリック
2. カメラへのアクセスを許可
3. 手をカメラに向けてジェスチャーを試す

### キーボードショートカット

- `C` - エフェクトをクリア
- `O` - カメラコントロールの有効/無効

## 📁 ファイル構成

```
mediapipe-Three.js/
├── index.html          # メインHTMLファイル
├── css/
│   └── style.css       # スタイルシート
├── js/
│   ├── main.js         # アプリケーション本体
│   ├── handTracking.js # MediaPipe統合
│   ├── gestures.js     # ジェスチャー認識
│   ├── effects.js      # パーティクルシステム
│   └── utils.js        # ヘルパー関数
└── README.md           # このファイル
```

## 🛠️ 技術スタック

- **3Dレンダリング**: [Three.js](https://threejs.org/) v0.160.0
- **手のトラッキング**: [MediaPipe Tasks Vision](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker) v0.10.22
- **言語**: Vanilla JavaScript (ES6 Modules)
- **スタイル**: CSS3 (カスタムプロパティ、Flexbox、アニメーション)

## 📋 動作要件

- モダンブラウザ（Chrome, Firefox, Edge, Safari）
- Webカメラ
- GPU（WebGL 2.0対応）
- HTTPS または localhost（カメラアクセスに必要）

## 🎨 カスタマイズ

### カラーパレットの変更

`js/utils.js` の `COLORS` オブジェクトを編集:

```javascript
export const COLORS = {
    primary: 0x8b5cf6,    // メインカラー
    secondary: 0x06b6d4,  // サブカラー
    accent: 0xf472b6,     // アクセント
    // ...
};
```

### パーティクル設定

`js/effects.js` の `ParticleSystem` クラスで調整:

```javascript
this.maxParticles = 3000;  // 最大パーティクル数
this.maxTrails = 500;      // 最大トレイル数
```

### ジェスチャー感度

`js/gestures.js` の閾値を調整:

```javascript
this.pinchStartThreshold = 0.06;  // ピンチ開始
this.pinchEndThreshold = 0.10;    // ピンチ終了
```

## 🔧 トラブルシューティング

### カメラが起動しない

- HTTPS または localhost でアクセスしているか確認
- ブラウザのカメラ権限を確認
- 他のアプリがカメラを使用していないか確認

### パフォーマンスが低い

- ブラウザのハードウェアアクセラレーションを有効に
- 他のタブやアプリを閉じる
- 低解像度モードを検討

### 手が検出されない

- 十分な照明があるか確認
- 手がカメラのフレーム内にあるか確認
- 背景と手のコントラストを確保

## 📄 ライセンス

MIT License

## 🙏 謝辞

- [Three.js](https://threejs.org/) - 3Dレンダリング
- [MediaPipe](https://mediapipe.dev/) - 手のトラッキング
- [Google Fonts](https://fonts.google.com/) - Orbitron, Rajdhani フォント

---

Made with ✨ by Hand Magic Studio
