# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 起動方法

```
cd env-4
python -m http.server 8080
# → http://localhost:8080 をブラウザで開く
```

ビルド・テスト・Lint のコマンドはない（静的な HTML/CSS/JS のみ）。

## アーキテクチャ概要

### モジュール構成

| ファイル | 役割 |
|---|---|
| `js/handTracking.js` | `HandTracker` クラス。MediaPipe Hand Landmarker の初期化・Webカメラ起動・`detectHands()` の実行・ランドマークスムージング |
| `js/gestures.js` | `GestureRecognizer` クラス。グー（FIST）/パー（OPEN）の判定、手のひら中心（`palmCenter`）、ヒステリシス、ピペット吸引ポーズ判定 |
| `js/main.js` | `HandGridController` クラス（メインアプリ）。グリッド・オブジェクト管理、掴む/離す、ピペット操作、コンタミネーション計算、実験プロトコル、描画ループ |

エントリポイントは `index.html` が `<script type="module" src="js/main.js">` で読み込む形。MediaPipe は `esm.sh` 経由で CDN から動的 import される（`hand_landmarker.task` モデルも Google Storage の URL から取得）。

### env-3 との差分

- **env-3**: MediaPipe Holistic（全身）を使用。pose の手首座標もコンタミ加算に利用。
- **env-4**: MediaPipe **Hand Landmarker のみ**（全身ポーズなし）。コンタミ加算は手のひら中心のみ。**ピペットオブジェクト**が追加されており、吸引（サムズアップ類似ポーズ）・排出（満タン時に液体をボックスに注ぐ）の機能がある。

### データフロー（毎フレーム）

```
HandTracker.detectHands()
  → 手ごとに { landmarks, worldLandmarks, handedness }
    → GestureRecognizer.recognize(landmarks, worldLandmarks)
      → { gesture: FIST/OPEN/NONE, palmCenter, isBack }
    → processHands() で掴む/離す/ピペット操作
    → updateContamination() でスコア更新
    → checkProtocolStep() でプロトコル進行
    → drawHandLandmarks() でキャンバス描画
```

### 重要な座標変換

- カメラ映像は CSS `scaleX(-1)` で鏡像表示。
- `getCellIndex(x, y)`: 正規化座標を受け、**x を反転**（`flippedX = 1 - x`）してからグリッドのセルインデックスを算出。
- `worldLandmarks`（メートル単位の3D座標）は手の裏表判定（手のひら法線 z）にのみ使用。

### ピペット機能（env-4 固有）

- `pipette.png` を右上 3×2 マスに横向きで固定表示。
- 吸引条件: サムズアップ類似ポーズ（ただし `pipetteSuckPoseOk()` でピンチ姿勢を除外）かつ口（`PIPETTE_TIP`）が手のひら中心に重なること。
- 液量 0〜100 をゲージで表示。満タン（≥99.5）でボックスの口付近に排出。

### グリッドとオブジェクト状態

- `cellObjects: Map<cellIndex, element[]>` — マス上のオブジェクト一覧。
- `heldObjects: Map<handIndex, { element, fromCellIndex, grabAngle, grabNormalZ, grabWasBack, isBack }>` — 手が掴んでいるオブジェクト。
- オブジェクト要素は `dataset.initialCell` で「元のマス番号」を保持（実験プロトコルの判定に使用）。

### 実験プロトコル

- グリッドが **3×3** かつ **実験モード ON** のときのみ有効。
- 状態機械: `Phase1_Step1` → `Phase1_Step2` → `Phase1_Step3` → `Phase2_Step1` → `Phase2_Step2` → `Phase2_Step3` → `PhaseDone`（または違反時に即 `PhaseFailed`）。
- 違反は drop 時（OPEN で離す瞬間）に判定。1 回でも `PhaseFailed` になるとリセットまで進行しない。

## 既知の注意点

- `main.js` 内に `fetch('http://127.0.0.1:7242/...')` によるデバッグログ送信コードが残っている。ローカルサーバが起動していない場合は無害なエラーで流れるが、本番環境では削除すること。
- `smoothingFactor = 1.0`（スムージングなし）で手ブレ軽減が実質無効。変更する場合は 0.6〜0.85 程度を検討。
