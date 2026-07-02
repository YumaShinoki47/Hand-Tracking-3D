/**
 * Hand Grid Controller - Main Application
 * ========================================
 * 画面を9分割し、マス内のオブジェクトをグーで掴み・パーで離す
 */

import { HandTracker } from './handTracking.js';
import { GestureRecognizer, GESTURE_TYPES, FIST_SUBTYPE } from './gestures.js';

/** オブジェクトがセル内に収まる最大サイズの割合（0〜1） */
const OBJECT_CELL_RATIO = 0.88;

/** コンタミネーションスコアの最大値（ゲージ100%対応） */
const CONTAMINATION_MAX = 200;
/** ゲージ充填率による色分け（%）：少ない=緑、中=黄、高い=赤 */
const CONTAMINATION_PCT_GREEN_MAX = 33;
const CONTAMINATION_PCT_YELLOW_MAX = 66;
/** 蓋が開いているとき手がboxの上にある場合の加算（1フレームあたり・1マス時） */
const CONTAMINATION_RATE_PER_FRAME = 1;
/** コンタミ加算の倍率：1マス=1倍、2マス=1.5倍、3マス=2倍… の増分（1マスあたり+0.5） */
const CONTAMINATION_MULTIPLIER_PER_EXTRA_CELL = 0.5;

/** 環境内の液体総量（box1 + box2 + ピペット = 常にこの値） */
const TOTAL_LIQUID = 100;

/** 実験用ボックスの画像（image/ 配下）。ファイル名は box1 / box2 で対応 */
const ASSET_IMAGE = {
    box1: { box: 'image/box_1.png', cover: 'image/cover_1.png' },
    box2: { box: 'image/box_2.png', cover: 'image/cover_2.png' }
};

/** ピペット（右上 3×2 マス・横向き表示） */
const PIPETTE_IMAGE = 'image/pipette.png';
/** 口の中心（ピペット矩形内の正規化 0=左端, 1=右端）。pipette.png は口が左 */
const PIPETTE_TIP_REL_X = 0.05;
const PIPETTE_TIP_REL_Y = 0.5;
/** 口の当たり半径 = min(幅,高さ) × 比率（ピクセル下限あり） */
const PIPETTE_TIP_RADIUS_RATIO = 0.12;
const PIPETTE_TIP_RADIUS_MIN_PX = 100;

/** ピペット液ゲージ 0〜100 を満タンまで上げる秒数 / 満タンから空にする秒数 */
const PIPETTE_LIQUID_FILL_SEC = 3;
const PIPETTE_LIQUID_DRAIN_SEC = 3;
/** 排出判定用（満タン扱い） */
const PIPETTE_LIQUID_FULL_THRESHOLD = 99.5;
/** 吸引判定: world座標での親指先端 ↔ 手のひら中心の距離（メートル）がこれ以上 → 吸引 */
const PIPETTE_SUCK_EXTENT_THRESHOLD = 0.07;
/** 排出判定: 親指 IP 関節の曲がり角 cosine がこれ未満 → 排出（0.5 ≈ 60°以上の屈曲） */
const PIPETTE_DISPENSE_BEND_COS = 0.5;
/** EMA平滑化係数（0に近いほど平滑、1に近いほど即時追従） */
const THUMB_EXTENT_ALPHA = 0.35;

/** サイドバー幅（px）。CSS の #sidebar width と一致させること */
const SIDEBAR_W = 190;

/**
 * world座標で親指先端 ↔ 手のひら中心（手首+4つのMCP平均）の距離を返す。
 * 伸びている(吸引) → 大きい値、折れている(排出) → 小さい値
 * @param {Array} worldLandmarks
 * @returns {number | null}
 */
function getThumbExtentWorld(worldLandmarks) {
    if (!worldLandmarks || worldLandmarks.length < 18) return null;
    const palmIndices = [0, 5, 9, 13, 17];
    let cx = 0, cy = 0, cz = 0;
    for (const i of palmIndices) {
        cx += worldLandmarks[i].x;
        cy += worldLandmarks[i].y;
        cz += worldLandmarks[i].z;
    }
    cx /= palmIndices.length;
    cy /= palmIndices.length;
    cz /= palmIndices.length;
    const tip = worldLandmarks[4];
    return Math.hypot(tip.x - cx, tip.y - cy, tip.z - cz);
}

/**
 * world座標での親指 IP 関節の屈曲 cosine を返す。
 * 1.0 = まっすぐ（伸びている）、0以下 = 強く折れている（グー）
 * @param {Array} worldLandmarks
 * @returns {number | null}
 */
function getThumbIPBendCos(worldLandmarks) {
    if (!worldLandmarks || worldLandmarks.length < 5) return null;
    const mcp = worldLandmarks[2]; // thumb MCP
    const ip  = worldLandmarks[3]; // thumb IP
    const tip = worldLandmarks[4]; // thumb tip
    const v1x = ip.x - mcp.x, v1y = ip.y - mcp.y, v1z = ip.z - mcp.z;
    const v2x = tip.x - ip.x,  v2y = tip.y - ip.y,  v2z = tip.z - ip.z;
    const len1 = Math.hypot(v1x, v1y, v1z);
    const len2 = Math.hypot(v2x, v2y, v2z);
    if (len1 < 1e-5 || len2 < 1e-5) return null;
    return (v1x * v2x + v1y * v2y + v1z * v2z) / (len1 * len2);
}

/**
 * 円（中心 cx,cy 半径 r）と軸平行矩形が交差するか
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {{ left: number, top: number, width: number, height: number } | null} rect
 */
function circleOverlapsRect(cx, cy, r, rect) {
    if (!rect || r <= 0) return false;
    const { left, top, width, height } = rect;
    const right = left + width;
    const bottom = top + height;
    const closestX = Math.max(left, Math.min(cx, right));
    const closestY = Math.max(top, Math.min(cy, bottom));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy <= r * r;
}

/**
 * 実験用ボックス1つ分。矩形・セル集合・フタの閉状態・コンタミ用の手判定をこのインスタンスに閉じる（box1/box2 を分離）。
 */
class ExperimentBox {
    /**
     * @param {HandGridController} controller
     * @param {string} coverContainerId
     * @param {number} colStartLargeGrid N≥4 のときの 3×3 ブロック左端列（box1=2, box2=5）
     */
    constructor(controller, coverContainerId, colStartLargeGrid) {
        this.controller = controller;
        this.coverContainerId = coverContainerId;
        this.colStartLargeGrid = colStartLargeGrid;
        this.liquid = 0;
        this.gaugeEl = null;
        this.gaugeWrapEl = null;
    }

    /** ゲージ表示を更新する（gaugeFill の width % を liquid/maxLiquid で設定） */
    updateGauge(maxLiquid) {
        if (!this.gaugeEl) return;
        const pct = maxLiquid > 0 ? Math.min(100, (this.liquid / maxLiquid) * 100) : 0;
        this.gaugeEl.style.width = pct + '%';
        if (this.gaugeWrapEl) {
            this.gaugeWrapEl.classList.toggle('box-liquid-at-max', this.liquid >= maxLiquid * 0.995);
        }
    }

    colStart() {
        const N = this.controller.gridCols;
        if (N < 3) return 0;
        return N >= 4 ? this.colStartLargeGrid : 0;
    }

    getRectPx() {
        const c = this.controller;
        const N = c.gridCols;
        const R = c.gridRows;
        if (N < 3) return null;
        const rowStart = R - 3;
        const GW = window.innerWidth - SIDEBAR_W;
        const H = window.innerHeight;
        const lt = c.get3x3BlockLeftTopPx(this.colStart(), rowStart);
        return {
            left: lt.left,
            top: lt.top,
            width: (3 / N) * GW,
            height: (3 / R) * H
        };
    }

    getCellIndices() {
        const c = this.controller;
        const N = c.gridCols;
        const R = c.gridRows;
        if (N < 3) return new Set();
        const colStart = this.colStart();
        const rowStart = R - 3;
        const indices = new Set();
        for (let row = rowStart; row < rowStart + 3 && row < R; row++) {
            for (let col = colStart; col < colStart + 3 && col < N; col++) {
                indices.add(row * N + col);
            }
        }
        return indices;
    }

    getCenterCellIndex() {
        const c = this.controller;
        const N = c.gridCols;
        const R = c.gridRows;
        if (N < 3) return null;
        const rowStart = R - 3;
        const colStart = this.colStart();
        return (rowStart + 1) * N + (colStart + 1);
    }

    getLidDistance() {
        const coverContainer = document.getElementById(this.coverContainerId);
        if (!coverContainer) return null;
        const centerCellIndex = this.getCenterCellIndex();
        if (centerCellIndex == null) return null;
        const target = this.controller.getCellCenterPx(centerCellIndex);
        const coverRect = coverContainer.getBoundingClientRect();
        const coverCenterX = coverRect.left + coverRect.width / 2;
        const coverCenterY = coverRect.top + coverRect.height / 2;
        return Math.hypot(coverCenterX - target.x, coverCenterY - target.y);
    }

    isLidClosed() {
        const dist = this.getLidDistance();
        return dist != null && dist <= 15;
    }

    /**
     * コンタミ用: 手のひら中心がこのボックスの viewport 矩形内か（getRectPx と同一。セル境界の誤判定を避ける）
     */
    isPalmCenterInForContamination(landmarks, handIndex) {
        if (!landmarks || !landmarks.length) return false;
        const c = this.controller;
        const gesture = c.gestureRecognizer.recognize(landmarks, handIndex);
        const pc = gesture.palmCenter;
        const clientX = (1 - pc.x) * window.innerWidth;
        const clientY = pc.y * window.innerHeight;
        const rect = this.getRectPx();
        if (!rect) return false;
        return clientX >= rect.left && clientX <= rect.left + rect.width &&
            clientY >= rect.top && clientY <= rect.top + rect.height;
    }
}

class HandGridController {
    constructor() {
        // DOM要素
        this.startBtn = document.getElementById('start-btn');
        this.startContainer = document.getElementById('start-container');
        this.backToStartBtn = document.getElementById('back-to-start-btn');
        this.loadingScreen = document.getElementById('loading-screen');
        this.gridCells = document.querySelectorAll('.grid-cell');
        this.objectDragLayer = document.getElementById('object-drag-layer');
        // 2D手描画
        this.handCanvas = document.getElementById('hand-canvas');
        this.handCtx = this.handCanvas.getContext('2d');
        this.showLandmarks = false;
        this.landmarkToggle = document.getElementById('landmark-toggle');
        
        // 状態
        this.isRunning = false;
        this.isInitialized = false;
        /** @type {Object.<number, HTMLElement[]>} セルインデックス → そのマスにあるオブジェクト要素の配列 */
        this.cellObjects = {};
        /** @type {Object.<number, { element: HTMLElement, fromCellIndex: number, grabAngle: number, isBack: boolean }>} 手インデックス → 掴んでいるオブジェクト */
        this.heldObjects = {};
        /** コンタミネーションスコア（蓋が開いているときに手がboxの上にあると上昇） */
        this.contaminationScore = 0;
        
        // モジュール
        this.handTracker = null;
        this.gestureRecognizer = new GestureRecognizer();
        
        // グリッド設定（Start 押下時に grid-size-select から読み取り）
        this.gridCols = 3;
        this.gridRows = 3;

        /** @type {ExperimentBox[]} box1 / box2 を別オブジェクトで保持（コンタミ・フタ・矩形の混線防止） */
        this.experimentBoxes = [
            new ExperimentBox(this, 'cover-container', 2),
            new ExperimentBox(this, 'cover-container-2', 5)
        ];

        /** @type {HTMLElement | null} 右上ピペットオーバーレイ */
        this.pipetteEl = null;
        /** ピペット液量 0〜100（掴み中のみ変化。離すとリセット） */
        this.pipetteLiquid = 0;
        /** @type {number|null} animate 用 dt 計算 */
        this._pipetteLiquidLastTs = null;
        /** 親指伸び量のEMA平滑値（null=未初期化） */
        this._thumbExtentSmooth = null;
        /** 親指 IP 屈曲 cos のEMA平滑値（null=未初期化） */
        this._thumbBendCosSmooth = null;
        /** ピペット現在の回転角（deg）。hold 中に更新、drop でリセット */
        this._pipetteRotationDeg = 0;
        
        // 初期化
        this.init();
    }
    
    /** 総セル数 */
    get totalCells() {
        return this.gridRows * this.gridCols;
    }

    /**
     * コンタミ表示：数値・ゲージ幅・色（ゲージ充填率で少ない=緑、中=黄、高い=赤）
     */
    updateStepHighlight() {
        const stepEls = document.querySelectorAll('.sidebar-steps li');
        if (!stepEls.length) return;
        const boxB = this.experimentBoxes[0];
        const boxA = this.experimentBoxes[1];
        const boxBLidClosed = boxB.isLidClosed();
        const boxBDrained = boxB.liquid <= TOTAL_LIQUID * 0.5;
        const boxALidClosed = boxA.isLidClosed();
        const boxAFilled = boxA.liquid >= TOTAL_LIQUID * 0.5;

        // フェーズ1完了: 箱Bのフタが閉まっていて液体が抜けている
        const phase1Done = boxBLidClosed && boxBDrained;
        // 全完了: フェーズ1完了 + 箱Aのフタが閉まっていて液体が入っている
        const allDone = phase1Done && boxALidClosed && boxAFilled;

        let activeStep;
        if (allDone) {
            activeStep = 7; // 全完了
        } else if (phase1Done) {
            // ステップ4〜6: 箱A操作フェーズ
            if (boxALidClosed) {
                activeStep = 4; // 箱Aのフタをとる
            } else if (!boxAFilled) {
                activeStep = 5; // ピペットで排出する
            } else {
                activeStep = 6; // 箱Aのフタを閉める
            }
        } else {
            // ステップ1〜3: 箱B操作フェーズ
            if (boxBLidClosed) {
                activeStep = 1; // 箱Bのフタをとる（初期状態）
            } else if (!boxBDrained) {
                activeStep = 2; // ピペットで吸う
            } else {
                activeStep = 3; // 箱Bのフタを閉める
            }
        }

        stepEls.forEach((el, i) => {
            el.classList.toggle('step-active', i + 1 === activeStep);
            el.classList.toggle('step-done', i + 1 < activeStep || allDone);
        });
    }

    updateContaminationDisplay() {
        const scoreEl = document.getElementById('contamination-score');
        const gaugeBar = document.getElementById('contamination-gauge-bar');
        if (!scoreEl) return;
        const score = this.contaminationScore;
        const rounded = Math.round(score);
        const pct = Math.min(100, (Math.min(score, CONTAMINATION_MAX) / CONTAMINATION_MAX) * 100);
        scoreEl.textContent = String(rounded);
        const C = 'contamination-score--';
        scoreEl.classList.remove(`${C}safe`, `${C}warn`, `${C}danger`);
        let barBg = '#22c55e';
        if (pct <= CONTAMINATION_PCT_GREEN_MAX) {
            scoreEl.classList.add(`${C}safe`);
            barBg = '#22c55e';
        } else if (pct <= CONTAMINATION_PCT_YELLOW_MAX) {
            scoreEl.classList.add(`${C}warn`);
            barBg = '#ca8a04';
        } else {
            scoreEl.classList.add(`${C}danger`);
            barBg = '#ef4444';
        }
        if (gaugeBar) {
            gaugeBar.style.width = pct + '%';
            gaugeBar.style.background = barBg;
        }
    }

    /**
     * 右下の 3×3 ブロック（下3行・左から3〜5列目、セル72,73,74,82,83,84,92,93,94）の中央セルインデックスを返す。
     * 10×10 のとき 82。N×N で N<3 のときは null。
     * @returns {number|null}
     */
    getCenterCellIndexOf3x3Block() {
        const N = this.gridCols;
        if (N < 3) return null;
        const colStart = N >= 4 ? 2 : 0;
        const centerRow = N - 2;
        const centerCol = colStart + 1;
        return centerRow * N + centerCol;
    }

    /**
     * グリッドのセルサイズに合わせたオブジェクトの1辺の長さ（px）。
     * セルより少し小さくしてはみ出しを防ぐ。
     */
    getObjectSize() {
        const cellW = (window.innerWidth - SIDEBAR_W) / this.gridCols;
        const cellH = window.innerHeight / this.gridRows;
        const size = Math.min(cellW, cellH) * OBJECT_CELL_RATIO;
        return Math.max(24, Math.floor(size)); // 最小24px
    }

    /** 3×3ブロックの幅・高さ（px）。cover のサイズ維持用。 */
    get3x3BlockSizePx() {
        const N = this.gridCols;
        return {
            width: ((window.innerWidth - SIDEBAR_W) * 3) / N,
            height: (window.innerHeight * 3) / this.gridRows
        };
    }

    /** 指定セルが 3×3 ブロック（下3行・左から3〜5列目、72,73,74,82,83,84,92,93,94）に含まれるか */
    isCellIn3x3Block(cellIndex) {
        const N = this.gridCols;
        if (N < 3) return false;
        const rows = [N - 3, N - 2, N - 1];
        const cols = N >= 4 ? [2, 3, 4] : [0, 1, 2];
        const row = Math.floor(cellIndex / N);
        const col = cellIndex % N;
        return rows.includes(row) && cols.includes(col);
    }

    /**
     * 指定セルの中心座標をピクセルで返す（表示の鏡像に合わせた座標系）
     * @param {number} cellIndex
     * @returns {{ x: number, y: number }}
     */
    getCellCenterPx(cellIndex) {
        const row = Math.floor(cellIndex / this.gridCols);
        const col = cellIndex % this.gridCols;
        const GW = window.innerWidth - SIDEBAR_W;
        const x = SIDEBAR_W + (1 - (col + 0.5) / this.gridCols) * GW;
        const y = ((row + 0.5) / this.gridRows) * window.innerHeight;
        return { x, y };
    }

    /**
     * 画面座標 (clientX, clientY) が含まれるセルの (col, row) を返す（鏡像に合わせたグリッド）。
     * @param {number} clientX
     * @param {number} clientY
     * @returns {{ col: number, row: number } | null} 範囲外なら null
     */
    getCellAtClient(clientX, clientY) {
        const W = window.innerWidth;
        const H = window.innerHeight;
        if (clientX < SIDEBAR_W) return null;
        const GW = W - SIDEBAR_W;
        // 鏡像: col 0 = 画面右 (clientX≈W)、col N-1 = グリッド左端 (clientX≈SIDEBAR_W)
        const col = Math.max(0, Math.min(this.gridCols - 1, Math.floor((W - clientX) / GW * this.gridCols)));
        const row = Math.floor((clientY / H) * this.gridRows);
        if (row < 0 || row >= this.gridRows) return null;
        return { col, row };
    }

    /**
     * 3×3ブロックの左上の viewport 座標 (left, top) を返す。startCol/startRow は 0,3,6,... にスナップ済み想定。
     * @param {number} startCol - 0, 3, 6, ...
     * @param {number} startRow - 0, 3, 6, ...
     * @returns {{ left: number, top: number }}
     */
    get3x3BlockLeftTopPx(startCol, startRow) {
        const GW = window.innerWidth - SIDEBAR_W;
        const H = window.innerHeight;
        const N = this.gridCols;
        const R = this.gridRows;
        const left = SIDEBAR_W + (1 - (startCol + 3) / N) * GW;
        const top = (startRow / R) * H;
        return { left, top };
    }

    /**
     * ピペット表示領域（列0〜2・行0〜1、画面右上）の viewport 矩形（px）。
     * @returns {{ left: number, top: number, width: number, height: number } | null} N<3 のとき null
     */
    getPipetteRectPx() {
        const N = this.gridCols;
        const R = this.gridRows;
        if (N < 3) return null;
        const W = window.innerWidth;
        const H = window.innerHeight;
        const lt = this.get3x3BlockLeftTopPx(0, 0);
        return {
            left: lt.left,
            top: lt.top,
            width: (3 / N) * (W - SIDEBAR_W),
            height: (2 / R) * H
        };
    }

    /** ピペット 3×2 ブロックの幅・高さ（px）。掴み・離し・追従で共通。 */
    getPipetteBlockSizePx() {
        const N = this.gridCols;
        const R = this.gridRows;
        return {
            width: ((window.innerWidth - SIDEBAR_W) * 3) / N,
            height: (window.innerHeight * 2) / R
        };
    }

    /**
     * ピペットをちょうど 3列×2行 のセル境界に張り付けるときの左上角 (left, top)。
     * 旧: ブロック中心を含む1マス→ anchor を `row_c-1` で決めていたが、2行ブロックの中心Yが
     * ちょうど行の境界上にあると floor の浮動小数誤差で row が 1 つずれ、縦スナップが一段ぶれていた。
     * 今: 合法な各 3×2 矩形に対し半開区間 [left, left+w) × [top, top+h) で点を含むタイルを一意に選ぶ。
     * どれにも入らないときは最も近い矩形の左上角（画面外ドロップ等）。
     * @param {number} clientX
     * @param {number} clientY
     * @returns {{ left: number, top: number }}
     */
    getPipetteSnapLeftTopPx(clientX, clientY) {
        const N = this.gridCols;
        const R = this.gridRows;
        const { width, height } = this.getPipetteBlockSizePx();
        let matchLt = null;
        for (let sr = 0; sr <= R - 2; sr++) {
            for (let sc = 0; sc <= N - 3; sc++) {
                const lt = this.get3x3BlockLeftTopPx(sc, sr);
                const inside =
                    clientX >= lt.left &&
                    clientX < lt.left + width &&
                    clientY >= lt.top &&
                    clientY < lt.top + height;
                if (inside) {
                    matchLt = lt;
                    break;
                }
            }
            if (matchLt) break;
        }
        if (matchLt) return { left: matchLt.left, top: matchLt.top };
        let bestLt = null;
        let bestD = Infinity;
        for (let sr = 0; sr <= R - 2; sr++) {
            for (let sc = 0; sc <= N - 3; sc++) {
                const lt = this.get3x3BlockLeftTopPx(sc, sr);
                const cx = lt.left + width / 2;
                const cy = lt.top + height / 2;
                const d = (clientX - cx) ** 2 + (clientY - cy) ** 2;
                if (d < bestD) {
                    bestD = d;
                    bestLt = lt;
                }
            }
        }
        if (bestLt) return { left: bestLt.left, top: bestLt.top };
        const pr = this.getPipetteRectPx();
        return pr ? { left: pr.left, top: pr.top } : { left: 0, top: 0 };
    }

    /** いずれかの手がピペットを掴んでいるか */
    isPipetteHeld() {
        return Object.values(this.heldObjects).some((h) => h.isPipette);
    }

    /**
     * 手のひら中心がピペット矩形上か（grid 上・ドラッグ中どちらでも getBoundingClientRect で判定）
     * @param {{ x: number, y: number }} palmCenter
     */
    isPalmOverPipette(palmCenter) {
        if (!this.pipetteEl) return false;
        const clientX = (1 - palmCenter.x) * window.innerWidth;
        const clientY = palmCenter.y * window.innerHeight;
        const rect = this.pipetteEl.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }

    /**
     * ピペット口の当たり半径（px）。幅・高さから算出（判定と可視化の共通値）。
     * @param {number} w
     * @param {number} h
     */
    computePipetteTipRadiusPx(w, h) {
        if (w <= 0 || h <= 0) return PIPETTE_TIP_RADIUS_MIN_PX;
        let r = Math.min(w, h) * PIPETTE_TIP_RADIUS_RATIO;
        return Math.max(r, PIPETTE_TIP_RADIUS_MIN_PX);
    }

    /**
     * 口の可視化円の大きさを当たり半径と同期（--pipette-tip-r-px を親にセット）
     */
    syncPipetteTipMarkerRadius() {
        if (!this.pipetteEl) return;
        const { width, height } = this.getPipetteBlockSizePx();
        const r = this.computePipetteTipRadiusPx(width, height);
        this.pipetteEl.style.setProperty('--pipette-tip-r-px', `${r}px`);
    }

    /**
     * ピペット「口」の円（viewport px）。当たり判定と可視化の基準を一致させる。
     * @returns {{ cx: number, cy: number, r: number } | null}
     */
    getPipetteTipClientCircle() {
        if (!this.pipetteEl) return null;
        const rect = this.pipetteEl.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        // 回転してもセンターは変わらない（transform-origin: 50% 50%）
        const elCx = rect.left + rect.width / 2;
        const elCy = rect.top + rect.height / 2;
        // 未回転時のサイズでオフセット計算（PIPETTE_TIP_REL_Y=0.5 なので rel_y=0）
        const { width: w, height: h } = this.getPipetteBlockSizePx();
        const rel_x = (PIPETTE_TIP_REL_X - 0.5) * w;
        const rotRad = this._pipetteRotationDeg * Math.PI / 180;
        const cx = elCx + Math.cos(rotRad) * rel_x;
        const cy = elCy + Math.sin(rotRad) * rel_x;
        const r = this.computePipetteTipRadiusPx(w, h);
        return { cx, cy, r };
    }

    /**
     * 手のひら中心がピペットの口の円内か
     * @param {{ x: number, y: number }} palmCenter
     */
    isPalmOverPipetteTip(palmCenter) {
        const c = this.getPipetteTipClientCircle();
        if (!c) return false;
        const px = (1 - palmCenter.x) * window.innerWidth;
        const py = palmCenter.y * window.innerHeight;
        return Math.hypot(px - c.cx, py - c.cy) <= c.r;
    }

    /**
     * ピペットの口の円が、蓋の開いているいずれかのボックス 3×3 矩形と重なるか
     */
    isPipetteTipOverlappingAnyOpenBox() {
        const tip = this.getPipetteTipClientCircle();
        if (!tip) return false;
        for (const box of this.experimentBoxes) {
            if (box.isLidClosed()) continue;
            const rect = box.getRectPx();
            if (circleOverlapsRect(tip.cx, tip.cy, tip.r, rect)) return true;
        }
        return false;
    }

    /**
     * ピペット口が重なっている蓋の開いた ExperimentBox を返す。なければ null。
     * @returns {ExperimentBox | null}
     */
    getBoxUnderPipetteTip() {
        const tip = this.getPipetteTipClientCircle();
        if (!tip) return null;
        for (const box of this.experimentBoxes) {
            if (box.isLidClosed()) continue;
            const rect = box.getRectPx();
            if (rect && circleOverlapsRect(tip.cx, tip.cy, tip.r, rect)) return box;
        }
        return null;
    }

    /** 液量ゲージの表示を --pipette-liquid-pct（0〜100）に反映 */
    updatePipetteLiquidGauge() {
        if (!this.pipetteEl) return;
        const pct = Math.min(100, Math.max(0, this.pipetteLiquid));
        this.pipetteEl.style.setProperty('--pipette-liquid-pct', String(pct));
        const atMax = this.pipetteLiquid >= PIPETTE_LIQUID_FULL_THRESHOLD;
        this.pipetteEl.classList.toggle('pipette-liquid-at-max', atMax);
    }

    /**
     * 手のひら中心が載っている cover コンテナを返す（どちらにも載っていなければ null）
     * @param {{ x: number, y: number }} palmCenter
     * @returns {HTMLElement | null}
     */
    getCoverContainerUnderPalm(palmCenter) {
        const clientX = (1 - palmCenter.x) * window.innerWidth;
        const clientY = palmCenter.y * window.innerHeight;
        for (const box of this.experimentBoxes) {
            const container = document.getElementById(box.coverContainerId);
            if (!container) continue;
            const rect = container.getBoundingClientRect();
            if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) return container;
        }
        return null;
    }

    /** @deprecated 代わりに getCoverContainerUnderPalm を使用 */
    isPalmOverCoverContainer(palmCenter) {
        return this.getCoverContainerUnderPalm(palmCenter) !== null;
    }

    /**
     * box の 3×3 領域を viewport 座標（px）で返す。buildGridDOM の初期位置と同じ式。
     * @returns {{ left: number, top: number, width: number, height: number } | null} N<3 のとき null
     */
    getBoxRectPx() {
        return this.experimentBoxes[0].getRectPx();
    }

    /**
     * 2つ目の box の 3×3 領域（セル75,76,77,85,86,87,95,96,97＝下3行・左から6〜8列目）を viewport px で返す。
     * @returns {{ left: number, top: number, width: number, height: number } | null}
     */
    getBox2RectPx() {
        return this.experimentBoxes[1].getRectPx();
    }

    /** 2つ目の box のセルインデックス一覧（75,76,77,85,86,87,95,96,97） */
    getBox2CellIndices() {
        return this.experimentBoxes[1].getCellIndices();
    }

    /** 1つ目/2つ目の box の中央セルインデックス（スナップ先と一致させるため）。 */
    getBoxCenterCellIndex(boxNum) {
        const box = this.experimentBoxes[boxNum - 1];
        return box ? box.getCenterCellIndex() : null;
    }

    /** 指定 cover の中心と対応する box のスナップ先（中央セル中心）との距離（px）。計算できないときは null。 */
    getLidDistance(coverContainerId) {
        const box = this.experimentBoxes.find((b) => b.coverContainerId === coverContainerId);
        return box ? box.getLidDistance() : null;
    }

    /** 指定 cover が対応する box とほぼ同じ位置にあるか */
    isLidClosedForContainer(coverContainerId) {
        const box = this.experimentBoxes.find((b) => b.coverContainerId === coverContainerId);
        return box ? box.isLidClosed() : false;
    }

    /** 蓋が閉じているか（両方の cover がそれぞれの box の上にあるか） */
    isLidClosed() {
        return this.experimentBoxes.every((b) => b.isLidClosed());
    }

    /**
     * 手のひら中心が box の 3×3 領域内にあるか
     * @param {{ x: number, y: number }} palmCenter
     * @returns {boolean}
     */
    isPalmOverBox(palmCenter) {
        const boxRect = this.getBoxRectPx();
        if (!boxRect) return false;
        const clientX = (1 - palmCenter.x) * window.innerWidth;
        const clientY = palmCenter.y * window.innerHeight;
        return clientX >= boxRect.left && clientX <= boxRect.left + boxRect.width &&
            clientY >= boxRect.top && clientY <= boxRect.top + boxRect.height;
    }

    /**
     * box の 3×3 領域に含まれるグリッドのセルインデックス一覧
     * @returns {Set<number>} N<3 のとき空の Set
     */
    getBoxCellIndices() {
        return this.experimentBoxes[0].getCellIndices();
    }

    /**
     * 手のランドマークのいずれかが box の 3×3 領域内にあるか（active マスと同じ判定）
     * @param {Array} landmarks - 手のランドマーク配列
     * @returns {boolean}
     */
    isHandOverBox(landmarks) {
        return this.countHandCellsInBox(landmarks) > 0;
    }

    /**
     * 手のランドマークが指定 box 内に存在するマス数（重複なし）
     * @param {Array} landmarks - 手のランドマーク配列
     * @param {number} [boxNum] - 1=最初のbox(72-94), 2=2つ目(75-97)。省略時は1
     * @returns {number}
     */
    countHandCellsInBox(landmarks, boxNum = 1) {
        const exp = this.experimentBoxes[boxNum - 1];
        if (!exp) return 0;
        const boxCells = exp.getCellIndices();
        if (!boxCells.size || !landmarks || !landmarks.length) return 0;
        const handCellsInBox = new Set();
        for (const lm of landmarks) {
            const idx = this.getCellIndex(lm.x, lm.y);
            if (idx >= 0 && boxCells.has(idx)) handCellsInBox.add(idx);
        }
        return handCellsInBox.size;
    }

    async init() {
        try {
            // ハンドトラッキング初期化
            this.handTracker = new HandTracker();
            await this.handTracker.init();

            // イベントリスナー
            this.startBtn.addEventListener('click', () => this.start());
            if (this.backToStartBtn) this.backToStartBtn.addEventListener('click', () => this.backToStart());
            window.addEventListener('resize', () => this.onResize());

            // ランドマーク表示トグル
            this.landmarkToggle.addEventListener('change', (e) => {
                this.showLandmarks = e.target.checked;
                if (!this.showLandmarks) {
                    this.handCtx.clearRect(0, 0, this.handCanvas.width, this.handCanvas.height);
                }
            });

            // マス番号表示トグル
            const gridNumbersToggle = document.getElementById('grid-numbers-toggle');
            const gridNumbersOverlay = document.getElementById('grid-numbers-overlay');
            if (gridNumbersToggle && gridNumbersOverlay) {
                gridNumbersToggle.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        gridNumbersOverlay.classList.remove('hidden');
                    } else {
                        gridNumbersOverlay.classList.add('hidden');
                    }
                });
                if (!gridNumbersToggle.checked) gridNumbersOverlay.classList.add('hidden');
            }

            // 初期化完了
            this.isInitialized = true;
            this.hideLoadingScreen();

            console.log('✨ Hand Grid Controller initialized');

        } catch (error) {
            console.error('❌ Initialization failed:', error);
            this.hideLoadingScreen();
        }
    }
    
    async start() {
        if (!this.isInitialized) return;

        this.contaminationScore = 0;
        this.pipetteLiquid = 0;
        this._pipetteLiquidLastTs = null;
        this._thumbExtentSmooth = null;
        this._thumbBendCosSmooth = null;

        try {
            this.gridCols = 10;
            this.gridRows = 10;

            this.buildGridDOM();

            // 液体初期化: box1 が TOTAL_LIQUID、box2・ピペットは空
            this.experimentBoxes[0].liquid = TOTAL_LIQUID;
            this.experimentBoxes[1].liquid = 0;
            this.experimentBoxes.forEach(b => b.updateGauge(TOTAL_LIQUID));

            await this.handTracker.startWebcam();
            this.isRunning = true;
            this.startContainer.classList.add('hidden');
            if (this.backToStartBtn) this.backToStartBtn.classList.remove('hidden');
            document.body.classList.remove('before-start');
            
            // 2Dキャンバスのサイズを設定
            this.handCanvas.width = window.innerWidth;
            this.handCanvas.height = window.innerHeight;
            
            this.updateContaminationDisplay();
            this.animate();
        } catch (error) {
            console.error('Failed to start:', error);
        }
    }

    /** スタート画面へ戻る（カメラ停止・UIをスタート前の状態に） */
    backToStart() {
        this.isRunning = false;
        if (this.handTracker) this.handTracker.stopWebcam();
        this.contaminationScore = 0;
        this.pipetteLiquid = 0;
        this._pipetteLiquidLastTs = null;
        this._thumbExtentSmooth = null;
        this._thumbBendCosSmooth = null;
        this.updateContaminationDisplay();
        if (this.pipetteEl) this.updatePipetteLiquidGauge();
        this.startContainer.classList.remove('hidden');
        if (this.backToStartBtn) this.backToStartBtn.classList.add('hidden');
        document.body.classList.add('before-start');
    }
    
    /** 選択された gridRows×gridCols で #grid-container と #grid-numbers-overlay を再構築 */
    buildGridDOM() {
        const gridContainer = document.getElementById('grid-container');
        const numbersOverlay = document.getElementById('grid-numbers-overlay');
        if (!gridContainer || !numbersOverlay) return;
        
        const total = this.totalCells;
        const N = this.gridCols;
        
        gridContainer.innerHTML = '';
        gridContainer.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
        gridContainer.style.gridTemplateRows = `repeat(${this.gridRows}, 1fr)`;
        
        // 3×3ブロック1: セル72,73,74,82,83,84,92,93,94
        if (N >= 3) {
            const rect = this.getBoxRectPx();
            if (rect) {
                const boxOverlay = document.createElement('div');
                boxOverlay.className = 'grid-cell-bg-3x3';
                boxOverlay.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background-image:url('${ASSET_IMAGE.box1.box}')`;
                gridContainer.appendChild(boxOverlay);
                const coverContainer = document.createElement('div');
                coverContainer.id = 'cover-container';
                coverContainer.className = 'grid-cell-bg-3x3 cover-container';
                coverContainer.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
                const coverEl = document.createElement('div');
                coverEl.id = 'cover-element';
                coverEl.className = 'cover-element';
                coverEl.style.cssText = `position:absolute;left:0;top:0;width:${rect.width}px;height:${rect.height}px;background-image:url('${ASSET_IMAGE.box1.cover}');background-size:100% 100%;background-repeat:no-repeat;background-position:center`;
                const coverLabelB = document.createElement('span');
                coverLabelB.className = 'cover-box-label';
                coverLabelB.textContent = 'B';
                coverEl.appendChild(coverLabelB);
                coverContainer.appendChild(coverEl);
                gridContainer.appendChild(coverContainer);
                // ゲージはフタより上（cover の後に追加し z-index:2 で前面に）
                const gaugeWrap1 = document.createElement('div');
                gaugeWrap1.className = 'box-liquid-gauge';
                gaugeWrap1.style.cssText = `position:fixed;left:${rect.left + rect.width * 0.08}px;top:${rect.top + rect.height * 0.88}px;width:${rect.width * 0.84}px;height:${Math.max(6, rect.height * 0.08)}px;z-index:2`;
                const gaugeFill1 = document.createElement('div');
                gaugeFill1.className = 'box-liquid-gauge-fill';
                const gaugeMaxLabel1 = document.createElement('div');
                gaugeMaxLabel1.className = 'box-liquid-gauge-max-label';
                gaugeMaxLabel1.textContent = 'MAX';
                gaugeWrap1.appendChild(gaugeFill1);
                gaugeWrap1.appendChild(gaugeMaxLabel1);
                gridContainer.appendChild(gaugeWrap1);
                this.experimentBoxes[0].gaugeEl = gaugeFill1;
                this.experimentBoxes[0].gaugeWrapEl = gaugeWrap1;
            }
            // 3×3ブロック2: セル75,76,77,85,86,87,95,96,97
            const rect2 = this.getBox2RectPx();
            if (rect2) {
                const boxOverlay2 = document.createElement('div');
                boxOverlay2.className = 'grid-cell-bg-3x3';
                boxOverlay2.style.cssText = `position:fixed;left:${rect2.left}px;top:${rect2.top}px;width:${rect2.width}px;height:${rect2.height}px;background-image:url('${ASSET_IMAGE.box2.box}')`;
                gridContainer.appendChild(boxOverlay2);
                const coverContainer2 = document.createElement('div');
                coverContainer2.id = 'cover-container-2';
                coverContainer2.className = 'grid-cell-bg-3x3 cover-container';
                coverContainer2.style.cssText = `position:fixed;left:${rect2.left}px;top:${rect2.top}px;width:${rect2.width}px;height:${rect2.height}px`;
                const coverEl2 = document.createElement('div');
                coverEl2.id = 'cover-element-2';
                coverEl2.className = 'cover-element';
                coverEl2.style.cssText = `position:absolute;left:0;top:0;width:${rect2.width}px;height:${rect2.height}px;background-image:url('${ASSET_IMAGE.box2.cover}');background-size:100% 100%;background-repeat:no-repeat;background-position:center`;
                const coverLabelA = document.createElement('span');
                coverLabelA.className = 'cover-box-label';
                coverLabelA.textContent = 'A';
                coverEl2.appendChild(coverLabelA);
                coverContainer2.appendChild(coverEl2);
                gridContainer.appendChild(coverContainer2);
                // ゲージはフタより上（cover の後に追加し z-index:2 で前面に）
                const gaugeWrap2 = document.createElement('div');
                gaugeWrap2.className = 'box-liquid-gauge';
                gaugeWrap2.style.cssText = `position:fixed;left:${rect2.left + rect2.width * 0.08}px;top:${rect2.top + rect2.height * 0.88}px;width:${rect2.width * 0.84}px;height:${Math.max(6, rect2.height * 0.08)}px;z-index:2`;
                const gaugeFill2 = document.createElement('div');
                gaugeFill2.className = 'box-liquid-gauge-fill';
                const gaugeMaxLabel2 = document.createElement('div');
                gaugeMaxLabel2.className = 'box-liquid-gauge-max-label';
                gaugeMaxLabel2.textContent = 'MAX';
                gaugeWrap2.appendChild(gaugeFill2);
                gaugeWrap2.appendChild(gaugeMaxLabel2);
                gridContainer.appendChild(gaugeWrap2);
                this.experimentBoxes[1].gaugeEl = gaugeFill2;
                this.experimentBoxes[1].gaugeWrapEl = gaugeWrap2;
            }
        }
        
        for (let i = 0; i < total; i++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.dataset.index = String(i);
            gridContainer.appendChild(cell);
        }

        const pipetteRect = this.getPipetteRectPx();
        if (pipetteRect) {
            const pipette = document.createElement('div');
            pipette.id = 'pipette-overlay';
            pipette.className = 'pipette-overlay';
            pipette.style.cssText =
                `position:fixed;left:${pipetteRect.left}px;top:${pipetteRect.top}px;` +
                `width:${pipetteRect.width}px;height:${pipetteRect.height}px;` +
                `background-image:url('${PIPETTE_IMAGE}');pointer-events:none;z-index:2`;
            pipette.style.setProperty('--pipette-tip-x-pct', String(PIPETTE_TIP_REL_X * 100));
            pipette.style.setProperty('--pipette-tip-y-pct', String(PIPETTE_TIP_REL_Y * 100));
            const gaugeWrap = document.createElement('div');
            gaugeWrap.className = 'pipette-liquid-gauge';
            gaugeWrap.setAttribute('aria-hidden', 'true');
            const gaugeFill = document.createElement('div');
            gaugeFill.className = 'pipette-liquid-gauge-fill';
            gaugeWrap.appendChild(gaugeFill);
            const maxLabel = document.createElement('span');
            maxLabel.className = 'pipette-liquid-gauge-max-label';
            maxLabel.textContent = 'MAX';
            maxLabel.setAttribute('aria-hidden', 'true');
            gaugeWrap.appendChild(maxLabel);
            pipette.appendChild(gaugeWrap);
            const tipMarker = document.createElement('div');
            tipMarker.className = 'pipette-tip-marker';
            tipMarker.setAttribute('aria-hidden', 'true');
            pipette.appendChild(tipMarker);
            gridContainer.appendChild(pipette);
            this.pipetteEl = pipette;
            this.syncPipetteTipMarkerRadius();
            this.updatePipetteLiquidGauge();
        } else {
            this.pipetteEl = null;
        }
        
        numbersOverlay.innerHTML = '';
        numbersOverlay.style.gridTemplateColumns = `repeat(${this.gridCols}, 1fr)`;
        numbersOverlay.style.gridTemplateRows = `repeat(${this.gridRows}, 1fr)`;
        for (let i = 0; i < total; i++) {
            const span = document.createElement('span');
            span.className = 'grid-number';
            span.textContent = String(i);
            numbersOverlay.appendChild(span);
        }
        
        this.gridCells = document.querySelectorAll('.grid-cell');
        this.cellObjects = {};
    }
    
    animate() {
        if (!this.isRunning) return;
        
        requestAnimationFrame(() => this.animate());
        
        const nowTs = performance.now();
        const dt = this._pipetteLiquidLastTs != null ? Math.min(0.1, (nowTs - this._pipetteLiquidLastTs) / 1000) : 0;
        this._pipetteLiquidLastTs = nowTs;

        // 2Dキャンバスをクリア
        this.handCtx.clearRect(0, 0, this.handCanvas.width, this.handCanvas.height);
        
        // 全てのグリッドセルを非アクティブに
        this.gridCells.forEach(cell => {
            cell.classList.remove('active');
            cell.classList.remove('arm-active');
        });

        const hands = this.handTracker.detectHands();

        if (hands && hands.length > 0) {
            this.processHands(hands);
        }

        // 蓋が開いているとき、各 ExperimentBox ごとに手がその box の上にあればスコア加算（box1/box2 は独立）
        for (const expBox of this.experimentBoxes) {
            if (expBox.isLidClosed()) continue;
            if (hands && hands.length > 0) {
                for (let i = 0; i < hands.length; i++) {
                    if (expBox.isPalmCenterInForContamination(hands[i].landmarks, i)) {
                        const count = 1;
                        const multiplier = 1 + (count - 1) * CONTAMINATION_MULTIPLIER_PER_EXTRA_CELL;
                        this.contaminationScore += CONTAMINATION_RATE_PER_FRAME * multiplier;
                    }
                }
            }
        }

        // コンタミネーション表示更新
        this.updateContaminationDisplay();
        this.updateStepHighlight();
        
        // 掴んだオブジェクトをそれぞれの手の位置・裏表に追従
        if (hands && Object.keys(this.heldObjects).length > 0) {
            Object.keys(this.heldObjects).forEach((key) => {
                const handIndex = parseInt(key, 10);
                const held = this.heldObjects[handIndex];
                if (hands[handIndex]) {
                    const landmarks = hands[handIndex].landmarks;
                    const gesture = this.gestureRecognizer.recognize(landmarks, handIndex);
                    const size = held.isCover
                        ? this.get3x3BlockSizePx()
                        : held.isPipette
                            ? this.getPipetteBlockSizePx()
                            : undefined;
                    this.updateHeldObjectPosition(held.element, gesture.palmCenter, size);
                    this.updateHeldObjectFlip(handIndex, hands[handIndex]);
                    if (held.isPipette) {
                        const el = held.element;
                        // 向き: 人差し指MCP(5)→小指MCP(17) の方向に + 端を向ける
                        // CSS scaleX(-1) ミラーに合わせて x 成分を反転
                        const lm5 = landmarks[5], lm17 = landmarks[17];
                        const dx = lm5.x - lm17.x;
                        const dy = lm17.y - lm5.y;
                        this._pipetteRotationDeg = Math.atan2(dy, dx) * 180 / Math.PI - 180;
                        el.style.transform = `rotate(${this._pipetteRotationDeg}deg)`;
                        const worldLm = hands[handIndex].worldLandmarks;
                        // 吸引: 親指先端 ↔ 手のひら中心の距離（大=伸びている）
                        const rawExtent = getThumbExtentWorld(worldLm);
                        if (rawExtent != null) {
                            this._thumbExtentSmooth = this._thumbExtentSmooth == null
                                ? rawExtent
                                : THUMB_EXTENT_ALPHA * rawExtent + (1 - THUMB_EXTENT_ALPHA) * this._thumbExtentSmooth;
                        }
                        // 排出: 親指 IP 関節の屈曲角（小=強く折れている）
                        const rawBend = getThumbIPBendCos(worldLm);
                        if (rawBend != null) {
                            this._thumbBendCosSmooth = this._thumbBendCosSmooth == null
                                ? rawBend
                                : THUMB_EXTENT_ALPHA * rawBend + (1 - THUMB_EXTENT_ALPHA) * this._thumbBendCosSmooth;
                        }
                        const isSuck = this._thumbExtentSmooth != null && this._thumbExtentSmooth > PIPETTE_SUCK_EXTENT_THRESHOLD;
                        const isDispense = this._thumbBendCosSmooth != null && this._thumbBendCosSmooth < PIPETTE_DISPENSE_BEND_COS && !isSuck;
                        el.classList.toggle('pipette-suck', isSuck);
                        el.classList.toggle('pipette-dispense', isDispense && !isSuck);
                        if (gesture.type === GESTURE_TYPES.FIST) {
                            const targetBox = this.getBoxUnderPipetteTip();
                            if (targetBox) {
                                if (isSuck && targetBox.liquid > 0) {
                                    const rate = (100 / PIPETTE_LIQUID_FILL_SEC) * dt;
                                    const delta = Math.min(rate, 100 - this.pipetteLiquid, targetBox.liquid);
                                    this.pipetteLiquid += delta;
                                    targetBox.liquid -= delta;
                                    targetBox.updateGauge(TOTAL_LIQUID);
                                } else if (
                                    gesture.fistSubType === FIST_SUBTYPE.FULL &&
                                    this.pipetteLiquid >= PIPETTE_LIQUID_FULL_THRESHOLD &&
                                    targetBox === this.experimentBoxes[1]
                                ) {
                                    // 満タン + 完全グー + 箱Aの上 → 箱Aに排出
                                    const rate = (100 / PIPETTE_LIQUID_DRAIN_SEC) * dt;
                                    const delta = Math.min(rate, this.pipetteLiquid, TOTAL_LIQUID - targetBox.liquid);
                                    this.pipetteLiquid -= delta;
                                    targetBox.liquid += delta;
                                    targetBox.updateGauge(TOTAL_LIQUID);
                                } else if (isDispense && this.pipetteLiquid > 0) {
                                    const rate = (100 / PIPETTE_LIQUID_DRAIN_SEC) * dt;
                                    const delta = Math.min(rate, this.pipetteLiquid, TOTAL_LIQUID - targetBox.liquid);
                                    this.pipetteLiquid -= delta;
                                    targetBox.liquid += delta;
                                    targetBox.updateGauge(TOTAL_LIQUID);
                                }
                            }
                        }
                        this.updatePipetteLiquidGauge();
                    }
                }
            });
        }
        if (this.pipetteEl && this.isPipetteHeld()) {
            this.syncPipetteTipMarkerRadius();
        }
        
    }
    
    /**
     * オブジェクトが現在どのマスにいるかを返す。掴んでいる場合は -1。
     * @param {HTMLElement} element - オブジェクトの wrapper 要素
     * @returns {number} セルインデックス (0 〜 totalCells-1) または -1
     */
    getCellOfObject(element) {
        for (let cellIndex = 0; cellIndex < this.totalCells; cellIndex++) {
            const arr = this.cellObjects[cellIndex];
            if (arr && arr.includes(element)) return cellIndex;
        }
        return -1;
    }
    
    /**
     * 手のひらの向きの角度を取得（ラジアン）。手首→中指付け根のベクトル。
     * @param {Array} landmarks - 手のランドマーク
     * @returns {number} 角度（ラジアン）
     */
    getPalmAngle(landmarks) {
        if (!landmarks || landmarks.length < 10) return 0;
        const wrist = landmarks[0];
        const middleMcp = landmarks[9];
        return Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x);
    }
    
    /**
     * worldLandmarks から手のひら法線の z 成分を取得。
     * 手のひらがカメラ向きなら正、手の甲がカメラ向きなら負になる想定。
     * @param {Array} worldLandmarks - 手のワールドランドマーク (x,y,z メートル)
     * @returns {number|null} 法線 z 成分。取得できないときは null
     */
    getPalmNormalZ(worldLandmarks) {
        if (!worldLandmarks || worldLandmarks.length < 18) return null;
        const wrist = worldLandmarks[0];
        const indexMcp = worldLandmarks[5];
        const pinkyMcp = worldLandmarks[17];
        const ax = indexMcp.x - wrist.x;
        const ay = indexMcp.y - wrist.y;
        const az = indexMcp.z - wrist.z;
        const bx = pinkyMcp.x - wrist.x;
        const by = pinkyMcp.y - wrist.y;
        const bz = pinkyMcp.z - wrist.z;
        return ax * by - ay * bx;
    }
    
    /**
     * 掴んでいるオブジェクトの裏表を「手の表裏」に合わせて更新。
     * worldLandmarks の法線 z の符号が掴んだときと反転したら裏側表示。
     */
    updateHeldObjectFlip(handIndex, hand) {
        const held = this.heldObjects[handIndex];
        if (!held) return;
        if (held.isPipette) return;
        return; // FLIP_DISABLED: 裏返し機能を一時無効化（再有効化する場合はこの行を削除）
        const landmarks = hand.landmarks;
        const worldLandmarks = hand.worldLandmarks;
        let isBack = false;
        const grabWasBack = held.grabWasBack === true;
        if (worldLandmarks && held.grabNormalZ != null) {
            const currentNormalZ = this.getPalmNormalZ(worldLandmarks);
            if (currentNormalZ != null) {
                const handFlipped = currentNormalZ * held.grabNormalZ < 0;
                isBack = handFlipped !== grabWasBack;
            }
        }
        if (held.grabNormalZ == null) {
            const currentAngle = this.getPalmAngle(landmarks);
            let diff = currentAngle - held.grabAngle;
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;
            const handRotated = Math.abs(diff) > (Math.PI / 6);
            isBack = handRotated !== grabWasBack;
        }
        if (isBack !== held.isBack) {
            held.isBack = isBack;
            if (held.isCover) {
                held.element.classList.toggle('flipped', isBack);
            } else {
                const inner = held.element.querySelector('.grid-object-inner');
                if (inner) inner.classList.toggle('flipped', isBack);
            }
        }
    }
    
    /**
     * 指定したセルに表裏のある四角オブジェクトを配置
     * @param {number[]} cellIndices - オブジェクトを置くセルのインデックス
     * @param {string} [frontImageUrl] - 表 face に表示する画像の URL（省略時はグラデーション）
     */
    createGridObjects(cellIndices, frontImageUrl) {
        const size = this.getObjectSize();
        cellIndices.forEach((cellIndex) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'grid-object';
            wrapper.style.width = size + 'px';
            wrapper.style.height = size + 'px';
            const inner = document.createElement('div');
            inner.className = 'grid-object-inner';
            const front = document.createElement('div');
            front.className = 'grid-object-front';
            if (frontImageUrl) {
                front.style.backgroundImage = `url(${frontImageUrl})`;
                front.style.backgroundSize = 'cover';
                front.style.backgroundPosition = 'center';
            }
            const back = document.createElement('div');
            back.className = 'grid-object-back';
            inner.appendChild(front);
            inner.appendChild(back);
            wrapper.appendChild(inner);
            wrapper.dataset.initialCell = String(cellIndex);
            this.gridCells[cellIndex].appendChild(wrapper);
            this.cellObjects[cellIndex] = [wrapper];
        });
    }
    
    /**
     * 掴んでいるオブジェクトの表示位置を手のひらに合わせて更新（手の中心とオブジェクトの中心が重なる）
     * @param {HTMLElement} element - 対象のオブジェクト要素
     * @param {{ x: number, y: number }} palmCenter - 手のひらの正規化座標
     * @param {{ width: number, height: number }} [explicitSize] - 指定時はその幅・高さで中央揃え（cover の 3×3 用）
     */
    updateHeldObjectPosition(element, palmCenter, explicitSize) {
        if (!element) return;
        const W = window.innerWidth;
        const h = window.innerHeight;
        const sizeW = explicitSize ? explicitSize.width : (element.offsetWidth || this.getObjectSize());
        const sizeH = explicitSize ? explicitSize.height : (element.offsetHeight || this.getObjectSize());
        const flippedX = 1 - palmCenter.x;
        const left = flippedX * W - sizeW / 2;
        const top = palmCenter.y * h - sizeH / 2;
        element.style.left = left + 'px';
        element.style.top = top + 'px';
    }
    
    processHands(hands) {
        // 両手分: ランドマーク描画・セルのアクティブ化・掴み/離しを手ごとに判定
        hands.forEach((hand, handIndex) => {
            const landmarks = hand.landmarks;
            const gesture = this.gestureRecognizer.recognize(landmarks, handIndex);
            const palmCenter = gesture.palmCenter;
            const cellIndex = this.getCellIndex(palmCenter.x, palmCenter.y);

            if (this.showLandmarks) {
                this.drawHandLandmarks(landmarks, palmCenter);
            }
            // 手のランドマークが存在する全てのマスをアクティブ表示
            const activeCellIndices = new Set();
            for (const lm of landmarks) {
                const idx = this.getCellIndex(lm.x, lm.y);
                if (idx >= 0 && idx < this.totalCells) activeCellIndices.add(idx);
            }
            activeCellIndices.forEach((idx) => this.gridCells[idx].classList.add('active'));

            // グー: 掴む（cover 優先: 手のひらが載っている cover を掴む。そうでなければマスのオブジェクト）
            if (gesture.type === GESTURE_TYPES.FIST) {
                if (!this.heldObjects[handIndex]) {
                    const coverContainer = this.getCoverContainerUnderPalm(palmCenter);
                    const coverEl = coverContainer ? coverContainer.querySelector('.cover-element') : null;
                    const wouldGrabCover = !!(coverEl && coverContainer && coverEl.parentElement === coverContainer);
                    if (wouldGrabCover) {
                        this.grabCover(handIndex, palmCenter, coverContainer, hand);
                    } else if (!this.isPipetteHeld() && this.isPalmOverPipette(palmCenter)) {
                        this.grabPipette(handIndex, palmCenter, hand);
                    } else {
                        const arr = this.cellObjects[cellIndex];
                        if (cellIndex >= 0 && arr && arr.length > 0) {
                            this.grabObject(handIndex, cellIndex, palmCenter, hand);
                        }
                    }
                }
            }
            // パー: 離す
            if (gesture.type === GESTURE_TYPES.OPEN) {
                if (this.heldObjects[handIndex]) {
                    if (this.heldObjects[handIndex].isCover) {
                        this.dropCover(handIndex);
                    } else if (this.heldObjects[handIndex].isPipette) {
                        this.dropPipette(handIndex);
                    } else if (cellIndex >= 0 && cellIndex < this.totalCells) {
                        this.dropObject(handIndex, cellIndex);
                    }
                }
            }
        });
    }
    
    /** cover を掴む（3×3サイズを維持したままドラッグレイヤーへ）。マス上の四角オブジェクトと同様に裏表を追従。 */
    grabCover(handIndex, palmCenter, coverContainer, hand) {
        const coverEl = coverContainer ? coverContainer.querySelector('.cover-element') : null;
        if (!coverEl || !coverContainer || coverEl.parentElement !== coverContainer) return;
        const { width, height } = this.get3x3BlockSizePx();
        coverEl.remove();
        this.objectDragLayer.appendChild(coverEl);
        coverEl.classList.add('held');
        coverEl.style.width = width + 'px';
        coverEl.style.height = height + 'px';
        coverEl.style.left = '';
        coverEl.style.top = '';
        const landmarks = hand.landmarks;
        const worldLandmarks = hand.worldLandmarks;
        const grabAngle = this.getPalmAngle(landmarks);
        const grabNormalZ = worldLandmarks ? this.getPalmNormalZ(worldLandmarks) : null;
        const grabWasBack = coverEl.classList.contains('flipped');
        this.heldObjects[handIndex] = { element: coverEl, isCover: true, coverContainer, grabAngle, grabNormalZ, grabWasBack, isBack: grabWasBack };
        this.updateHeldObjectPosition(coverEl, palmCenter, { width, height });
    }

    /**
     * cover を離す。掴んでいたコンテナに戻して配置（ワープ防止）。
     * @param {number} handIndex
     */
    dropCover(handIndex) {
        const held = this.heldObjects[handIndex];
        if (!held || !held.isCover) return;
        const coverEl = held.element;
        const coverContainer = held.coverContainer || document.getElementById('cover-container');
        if (!coverContainer) return;
        const { width, height } = this.get3x3BlockSizePx();
        const rect = coverEl.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        // 離したときの cover の中心が含まれるマスを求め、そのマスの中心に 3×3 の中心が来るように配置
        const cell = this.getCellAtClient(centerX, centerY);
        const cellIndex = cell != null ? cell.row * this.gridCols + cell.col : 0;
        const cellCenter = this.getCellCenterPx(cellIndex);
        const snapLeft = cellCenter.x - width / 2;
        const snapTop = cellCenter.y - height / 2;
        coverEl.classList.remove('held');
        coverEl.style.width = '100%';
        coverEl.style.height = '100%';
        coverEl.style.left = '';
        coverEl.style.top = '';
        coverEl.remove();
        coverContainer.appendChild(coverEl);
        coverContainer.style.position = 'fixed';
        coverContainer.style.left = snapLeft + 'px';
        coverContainer.style.top = snapTop + 'px';
        coverContainer.style.width = width + 'px';
        coverContainer.style.height = height + 'px';
        delete this.heldObjects[handIndex];
    }

    /** ピペットを掴む（3×2 サイズのままドラッグレイヤーへ）。横向き固定のため裏表は追従しない。 */
    grabPipette(handIndex, palmCenter, hand) {
        if (!this.pipetteEl || this.isPipetteHeld()) return;
        const pipetteEl = this.pipetteEl;
        const { width, height } = this.getPipetteBlockSizePx();
        pipetteEl.remove();
        this.objectDragLayer.appendChild(pipetteEl);
        pipetteEl.classList.add('held');
        pipetteEl.style.width = width + 'px';
        pipetteEl.style.height = height + 'px';
        pipetteEl.style.left = '';
        pipetteEl.style.top = '';
        const landmarks = hand.landmarks;
        const worldLandmarks = hand.worldLandmarks;
        const grabAngle = this.getPalmAngle(landmarks);
        const grabNormalZ = worldLandmarks ? this.getPalmNormalZ(worldLandmarks) : null;
        this.heldObjects[handIndex] = {
            element: pipetteEl,
            isPipette: true,
            grabAngle,
            grabNormalZ,
            grabWasBack: false,
            isBack: false
        };
        this.updateHeldObjectPosition(pipetteEl, palmCenter, { width, height });
        this.syncPipetteTipMarkerRadius();
    }

    /**
     * ピペットを離す。離した位置にそのまま配置（グリッドスナップなし）。
     * @param {number} handIndex
     */
    dropPipette(handIndex) {
        const held = this.heldObjects[handIndex];
        if (!held || !held.isPipette) return;
        const pipetteEl = held.element;
        const gridContainer = document.getElementById('grid-container');
        if (!gridContainer) return;
        const { width, height } = this.getPipetteBlockSizePx();
        const rect = pipetteEl.getBoundingClientRect();
        // 回転時 getBoundingClientRect() は AABB を返すが、中心座標は回転に依存しない
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        pipetteEl.classList.remove('held', 'pipette-suck', 'pipette-dispense');
        pipetteEl.style.transform = `rotate(${this._pipetteRotationDeg}deg)`;
        pipetteEl.style.position = 'fixed';
        pipetteEl.style.left = (centerX - width / 2) + 'px';
        pipetteEl.style.top = (centerY - height / 2) + 'px';
        pipetteEl.style.width = width + 'px';
        pipetteEl.style.height = height + 'px';
        pipetteEl.remove();
        gridContainer.appendChild(pipetteEl);
        delete this.heldObjects[handIndex];
        this.syncPipetteTipMarkerRadius();
        this.updatePipetteLiquidGauge();
    }

    /** 指定した手で指定セルのオブジェクトを1つ掴む。手の甲を向けるとオブジェクトが裏返る。 */
    grabObject(handIndex, cellIndex, palmCenter, hand) {
        const arr = this.cellObjects[cellIndex];
        if (!arr || arr.length === 0) return;
        const el = arr.pop();
        if (arr.length === 0) delete this.cellObjects[cellIndex];
        el.remove();
        this.objectDragLayer.appendChild(el);
        el.classList.add('held');
        const landmarks = hand.landmarks;
        const worldLandmarks = hand.worldLandmarks;
        const grabAngle = this.getPalmAngle(landmarks);
        const grabNormalZ = worldLandmarks ? this.getPalmNormalZ(worldLandmarks) : null;
        const inner = el.querySelector('.grid-object-inner');
        const grabWasBack = inner ? inner.classList.contains('flipped') : false;
        this.heldObjects[handIndex] = { element: el, fromCellIndex: cellIndex, grabAngle, grabNormalZ, grabWasBack, isBack: grabWasBack };
        this.updateHeldObjectPosition(el, palmCenter);
    }
    
    /** 指定した手で掴んでいるオブジェクトを指定セルに置く */
    dropObject(handIndex, cellIndex) {
        const held = this.heldObjects[handIndex];
        if (!held) return;
        const el = held.element;
        const inner = el.querySelector('.grid-object-inner');
        el.classList.remove('held');
        el.style.left = '';
        el.style.top = '';
        el.remove();
        this.gridCells[cellIndex].appendChild(el);
        if (!this.cellObjects[cellIndex]) this.cellObjects[cellIndex] = [];
        this.cellObjects[cellIndex].push(el);
        delete this.heldObjects[handIndex];
    }
    
    /**
     * 正規化座標からグリッドセルのインデックスを取得
     * @param {number} x - 正規化X座標 (0-1)
     * @param {number} y - 正規化Y座標 (0-1)
     * @returns {number} セルインデックス (0 〜 totalCells-1)、範囲外は -1
     */
    getCellIndex(x, y) {
        // MediaPipe 正規化 x → viewport x（CSS mirror 後）
        const W = window.innerWidth;
        const GW = W - SIDEBAR_W;
        const vx = (1 - x) * W;
        // サイドバー領域（左端 SIDEBAR_W px）はグリッド外
        if (vx < SIDEBAR_W) return -1;
        // DOM の gridCells は左→右が col 0→N-1。vx が大きいほど（画面右）col が大きい
        const col = Math.min(this.gridCols - 1, Math.floor((vx - SIDEBAR_W) / GW * this.gridCols));
        const row = Math.floor(y * this.gridRows);
        if (col < 0 || row < 0 || row >= this.gridRows) return -1;
        return row * this.gridCols + col;
    }

    /**
     * MediaPipeのランドマークを2Dキャンバスに直接描画
     */
    drawHandLandmarks(landmarks, palmCenter) {
        const ctx = this.handCtx;
        const w = this.handCanvas.width;
        const h = this.handCanvas.height;
        
        // 接続情報
        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4],
            [0, 5], [5, 6], [6, 7], [7, 8],
            [0, 9], [9, 10], [10, 11], [11, 12],
            [0, 13], [13, 14], [14, 15], [15, 16],
            [0, 17], [17, 18], [18, 19], [19, 20],
            [5, 9], [9, 13], [13, 17]
        ];
        
        // ボーンを描画
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.8)';
        ctx.lineWidth = 3;
        connections.forEach(([start, end]) => {
            const p1 = landmarks[start];
            const p2 = landmarks[end];
            ctx.beginPath();
            ctx.moveTo(p1.x * w, p1.y * h);
            ctx.lineTo(p2.x * w, p2.y * h);
            ctx.stroke();
        });
        
        // 関節を描画
        landmarks.forEach((lm, idx) => {
            const x = lm.x * w;
            const y = lm.y * h;
            
            let color = '#8b5cf6';
            if (idx >= 1 && idx <= 4) color = '#f472b6';
            else if (idx >= 5 && idx <= 8) color = '#22d3ee';
            else if (idx >= 9 && idx <= 12) color = '#4ade80';
            else if (idx >= 13 && idx <= 16) color = '#fbbf24';
            else if (idx >= 17 && idx <= 20) color = '#f87171';
            
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
        });
        
        // 手のひらの中心を描画（大きな白い丸 + 十字線）
        if (palmCenter) {
            const cx = palmCenter.x * w;
            const cy = palmCenter.y * h;
            
            // 外側のリング
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, 15, 0, Math.PI * 2);
            ctx.stroke();
            
            // 内側の塗りつぶし
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.beginPath();
            ctx.arc(cx, cy, 8, 0, Math.PI * 2);
            ctx.fill();
            
            // 十字線
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx - 20, cy);
            ctx.lineTo(cx + 20, cy);
            ctx.moveTo(cx, cy - 20);
            ctx.lineTo(cx, cy + 20);
            ctx.stroke();
        }
    }

    hideLoadingScreen() {
        if (this.loadingScreen) {
            this.loadingScreen.classList.add('hidden');
        }
    }
    
    onResize() {
        this.handCanvas.width = window.innerWidth;
        this.handCanvas.height = window.innerHeight;
        if (this.pipetteEl && !this.isPipetteHeld()) {
            const { width, height } = this.getPipetteBlockSizePx();
            const rect = this.pipetteEl.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            this.pipetteEl.style.position = 'fixed';
            this.pipetteEl.style.left = (centerX - width / 2) + 'px';
            this.pipetteEl.style.top = (centerY - height / 2) + 'px';
            this.pipetteEl.style.width = width + 'px';
            this.pipetteEl.style.height = height + 'px';
        }
        if (this.pipetteEl) {
            this.syncPipetteTipMarkerRadius();
            this.updatePipetteLiquidGauge();
        }
    }
}

// 起動
window.addEventListener('DOMContentLoaded', () => {
    window.app = new HandGridController();
});
