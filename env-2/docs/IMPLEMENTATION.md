# Hand Grid Controller - 実装ドキュメント

このドキュメントでは、**Hand Grid Controller** アプリの主要な動作と、それを実現しているコードの概要を説明します。

---

## 1. アプリの概要

- **目的**: 画面を 9 分割したグリッド上で、**手のジェスチャー（グー／パー）** によりマス内のオブジェクトを「掴む」「離す」操作を行う。
- **技術**: Web カメラ映像に **MediaPipe Hand Landmarker** を適用し、手のランドマークからジェスチャーと手のひら位置を算出。オブジェクトは **DOM 要素** として配置・移動し、実験プロトコル（指定マス間の移動）に対応。

---

## 2. ファイル構成と役割

| ファイル | 役割 |
|----------|------|
| `index.html` | ページ構造（ビデオ、グリッド、オブジェクト用レイヤー、UI、プロトコル表示） |
| `css/style.css` | レイアウト・見た目（グリッド、オブジェクトの表裏、アクティブ表示など） |
| `js/main.js` | メインアプリ（`HandGridController`）：初期化、ループ、掴み/離し、プロトコル、描画 |
| `js/handTracking.js` | **HandTracker**: MediaPipe の初期化・Web カメラ・手検出・ランドマークスムージング |
| `js/gestures.js` | **GestureRecognizer**: グー/パー判定、手のひら中心、ヒステリシス |

---

## 3. 起動〜メインループの流れ

### 3.1 初期化（`main.js`）

1. **DOMContentLoaded** で `HandGridController` を生成。
2. **init()** 内で:
   - `HandTracker` を new し、`await this.handTracker.init()` で MediaPipe（Hand Landmarker）を読み込み。
   - スタートボタン、リサイズ、ランドマーク表示トグルのイベントを登録。
   - 初期化完了でローディング画面を非表示。

```javascript
// main.js - 起動
window.addEventListener('DOMContentLoaded', () => {
    window.app = new HandGridController();
});
```

### 3.2 スタート（`main.js`）

- ユーザーが **Start** を押すと **start()** が実行される。
- `handTracker.startWebcam()` でカメラを起動。
- 2D 手描画用キャンバスのサイズをウィンドウに合わせて設定。
- セル 6・7・8 に四角オブジェクトを 1 つずつ作成（`createGridObjects([6, 7, 8])`）。
- 実験モードが ON ならプロトコル状態を `Phase1_Step1` にし、指示 UI を更新。
- **animate()** を `requestAnimationFrame` でループ開始。

### 3.3 メインループ（`main.js` - animate）

毎フレームの処理の流れ:

1. **手の検出**: `this.handTracker.detectHands()` で検出結果を取得。
2. **手ごとの処理**: `processHands(hands)` でランドマーク描画・セルアクティブ化・掴み/離し判定。
3. **掴んだオブジェクトの追従**: 各手に紐づくオブジェクトの位置と裏表を更新。
4. **実験プロトコル**: 有効時は `checkProtocolStep()` でステップ進行、`updateProtocolUI()` で表示更新。

---

## 4. 手の検出（handTracking.js）

### 4.1 MediaPipe の初期化

- **esm.sh** 経由で `@mediapipe/tasks-vision` を読み込み。
- **FilesetResolver.forVisionTasks** で WASM を指定。
- **HandLandmarker.createFromOptions** で:
  - モデル: `hand_landmarker.task`（Google ストレージの URL）。
  - `runningMode: 'VIDEO'`、`numHands: 2`、各種 confidence を設定。

### 4.2 手の検出（detectHands）

- `detectForVideo(this.videoEl, performance.now())` でビデオフレームから検出。
- 同じ `currentTime` のフレームはキャッシュ（`lastResult`）を返して重複実行を防ぐ。
- 返却形式: 手ごとに `{ landmarks, worldLandmarks, handedness, handednessScore }`。
- **landmarks**: 画面座標系の正規化座標（x, y, z）。
- **worldLandmarks**: 実世界メートル単位の 3D 座標（手の向き・裏表の計算に使用）。

### 4.3 ランドマークのスムージング

- **smoothLandmarks(landmarks, handIndex)**: 前フレームのランドマークと線形補間（`smoothingFactor = 0.8`）し、手の揺れを軽減。

---

## 5. ジェスチャー認識（gestures.js）

### 5.1 役割

- **グー（FIST）**: 掴む操作。
- **パー（OPEN）**: 離す操作。
- 手のひら中心（`palmCenter`）: どのマスにいるか・掴んだオブジェクトの表示位置の基準。

### 5.2 指の開閉判定

- **HAND_LANDMARKS**: MediaPipe の 21 点インデックス（手首・各指 MCP/PIP/TIP など）を定数で参照。
- **親指**: 拇指先〜人差し指 MCP の距離が、拇指 MCP〜人差し指 MCP の距離の 0.8 倍より大きければ「伸びている」。
- **その他 4 本**: 指先〜手首の距離が PIP〜手首の距離の 1.1 倍より大きければ「伸びている」。

### 5.3 ジェスチャー分類

- **extendedCount**（伸びている指の数）:
  - ≤ 1 → **FIST（グー）**
  - ≥ 4 → **OPEN（パー）**
  - それ以外 → **NONE**

### 5.4 ヒステリシス（applyHysteresis）

- 直近数フレーム（`historySize = 3`）のジェスチャー履歴を保持。
- 過半数が同じタイプならそのタイプを採用し、グー/パーの切り替え時のチラつきを抑える。

### 5.5 手のひら中心（getPalmCenter）

- 手首と 4 指の MCP（人差し指・中指・薬指・小指）の 5 点の平均を `palmCenter` として返す。正規化座標 (0–1) で使用。

---

## 6. グリッドとマス判定（main.js）

### 6.1 グリッド構造

- **index.html**: `#grid-container` 内に `data-index="0"` 〜 `"8"` の 9 個の `.grid-cell`。
- レイアウトは CSS の `grid-template-columns/rows: repeat(3, 1fr)` で 3×3。
- マス番号: 左上 0、右下 8（行優先）。

### 6.2 マスインデックスの算出（getCellIndex）

- 入力: 正規化座標 `(x, y)`（手のひら中心）。
- カメラが鏡像のため **x は反転**: `flippedX = 1 - x`。
- `col = floor(flippedX * 3)`, `row = floor(y * 3)` で 0–2 の列・行を算出。
- `cellIndex = row * 3 + col`。範囲外は -1。

---

## 7. オブジェクトの掴み・離し（main.js）

### 7.1 オブジェクトの表現

- 各オブジェクトは **div**（`.grid-object`）で、内側に `.grid-object-inner`（表 `.grid-object-front` / 裏 `.grid-object-back`）を持つ。
- **cellObjects**: `cellIndex → そのマスにあるオブジェクト要素の配列`。
- **heldObjects**: `handIndex → { element, fromCellIndex, grabAngle, grabNormalZ, grabWasBack, isBack }`（掴んでいるオブジェクト情報）。

### 7.2 掴む（grabObject）

- **条件**: ジェスチャーが **FIST**、その手がまだ何も持っていない、かつ現在のマスにオブジェクトが 1 つ以上ある。
- **処理**:
  - そのマスのオブジェクト配列から 1 つ `pop` し、グリッドセルから `remove`。
  - `#object-drag-layer` に append し、`.held` を付与。
  - 掴んだ瞬間の手のひら角度（`getPalmAngle`）と、world 座標の手のひら法線 z（`getPalmNormalZ`）を保存。
  - `heldObjects[handIndex]` に登録し、`updateHeldObjectPosition` で手のひら位置に合わせて表示。

### 7.3 離す（dropObject）

- **条件**: ジェスチャーが **OPEN**、その手がオブジェクトを掴んでおり、手のひらが有効なマス（0–8）にある。
- **処理**:
  - `.held` を外し、`left`/`top` をクリア。
  - 要素をそのマスの `.grid-cell` に append し、`cellObjects[cellIndex]` に push。
  - `heldObjects[handIndex]` を削除。

### 7.4 掴んだオブジェクトの位置更新（updateHeldObjectPosition）

- 毎フレーム、`gestureRecognizer.recognize` から得た `palmCenter`（正規化）を使う。
- 画面幅・高さでピクセル座標に変換。x は鏡像のため `flippedX = 1 - palmCenter.x`。
- オブジェクト中心が手のひらに来るよう、`left` / `top` を設定（OBJECT_SIZE で中央揃え）。

### 7.5 掴んだオブジェクトの裏表（updateHeldObjectFlip）

- **worldLandmarks がある場合**: 手のひら法線の z 成分（`getPalmNormalZ`: 手首と人差し指 MCP・小指 MCP の外積で近似）を取得。掴んだときの符号と現在の符号が反転したら「手を裏返した」とみなし、オブジェクトの `.grid-object-inner` に `.flipped` をトグル（CSS の `rotateY(180deg)` で裏表示）。
- **worldLandmarks がない場合**: 掴んだときの手のひら角度（`getPalmAngle`: 手首→中指 MCP のベクトルの atan2）と現在の角度の差が π/6 を超えたら回転とみなして同様に裏表を切り替え。

---

## 8. 実験プロトコル（main.js）

### 8.1 目的

指定された順序で「あるマスから別のマスへオブジェクトを動かす」ことを促し、違反時に「失敗」を表示する。

### 8.2 状態と遷移

- **Phase1_Step1**: 6 → 3 に移動。
- **Phase1_Step2**: 7 → 4 に移動。
- **Phase1_Step3**: 8 → 5 に移動。
- **Phase2_Step1**: 3 → 6 に戻す。
- **Phase2_Step2**: 4 → 7 に戻す。
- **Phase2_Step3**: 5 → 8 に戻す。
- **PhaseDone**: 全ステップ完了（「クリア！」表示）。
- **PhaseFailed**: 違反が一度でもあった（「失敗！」表示）。

### 8.3 ステップ進行（checkProtocolStep）

- **getExpectedMoveForCurrentStep()** で、現在の状態に対応する「初期マス → 目標マス」を取得。
- 全セルを走査し、`dataset.initialCell` が「初期マス」と一致するオブジェクトの**現在のマス**（`getCellOfObject`）が「目標マス」になっていれば、状態を次のステップ（または PhaseDone）に進め、クリア時は `#protocol-clear` を表示。

### 8.4 違反判定

- **離すとき**（`processHands` 内、OPEN で drop する直前）に判定。
- 実験モード ON かつ PhaseDone/PhaseFailed でないとき、今から離すマスが「現在ステップの目標マス」でない、または対象オブジェクトの初期マスが「現在ステップの初期マス」でない場合、`protocolState = 'PhaseFailed'` とし、`#protocol-failed` を表示。

### 8.5 UI 表示（updateProtocolUI）

- `#protocol-instruction` に、現在状態に対応する文言（例: 「6 → 3 に移動」）を表示。
- 実験モード OFF のときは指示を空にする。

---

## 9. 2D 手の描画（main.js）

- **drawHandLandmarks(landmarks, palmCenter)**:
  - MediaPipe の 21 点を、決まった接続（bones）で線描画。
  - 各ランドマークを指ごとに色分けした円で描画。
  - 手のひら中心（`palmCenter`）を白い円と十字で強調。
- キャンバスは `#hand-canvas`。`transform: scaleX(-1)` でカメラと左右を合わせている。
- ランドマーク表示は「ランドマーク」トグルが ON のときのみ実行され、OFF のときはキャンバスをクリア。

---

## 10. HTML・CSS 上の補足

- **#webcam**: 全画面でカメラ映像。`scaleX(-1)` で鏡像。
- **#video-overlay**: その上に半透明の暗いレイヤー。
- **#grid-container**: 9 マスのグリッド。セルは `pointer-events: none`（クリックは透過）。
- **#object-drag-layer**: 掴んだオブジェクトを乗せるレイヤー。`pointer-events: none`。
- **#hand-canvas**: 手の骨・関節・手のひら中心の描画。
- **.grid-object**: 表裏あり。`.grid-object-inner.flipped` で `rotateY(180deg)`。`.held` のときは `#object-drag-layer` 上で `position: absolute` かつ scale で少し縮小。
- セル 6・7・8 には `.grid-cell-bg` で box.png の背景を表示（掴めるのはその上に作成される `.grid-object`）。

---

## 11. まとめ

| 機能 | 主な実装場所 |
|------|----------------|
| 手の検出 | `handTracking.js`: MediaPipe Hand Landmarker、detectForVideo、スムージング |
| グー/パー判定 | `gestures.js`: 指の伸び判定、extendedCount、ヒステリシス |
| マス判定 | `main.js`: getCellIndex（正規化座標→3×3 インデックス、x 反転） |
| 掴む/離す | `main.js`: processHands 内の FIST/OPEN 分岐、grabObject、dropObject |
| 掴んだオブジェクトの追従 | `main.js`: updateHeldObjectPosition（palmCenter）、updateHeldObjectFlip（法線 z または角度） |
| 実験プロトコル | `main.js`: protocolState、getExpectedMoveForCurrentStep、checkProtocolStep、離し時の違反判定、updateProtocolUI |
| 手の描画 | `main.js`: drawHandLandmarks（bones + 関節 + palmCenter） |

以上が、Hand Grid Controller の主要動作とその実装の対応です。
