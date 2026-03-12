/**
 * Hand Grid Controller - Main Application
 * ========================================
 * 画面を9分割し、マス内のオブジェクトをグーで掴み・パーで離す
 */

import { HandTracker } from './handTracking.js';
import { GestureRecognizer, GESTURE_TYPES } from './gestures.js';

/** オブジェクトがセル内に収まる最大サイズの割合（0〜1） */
const OBJECT_CELL_RATIO = 0.88;

/** コンタミネーションスコアの最大値（ゲージ100%対応） */
const CONTAMINATION_MAX = 200;
/** 蓋が開いているとき手がboxの上にある場合の加算（1フレームあたり・1マス時） */
const CONTAMINATION_RATE_PER_FRAME = 1;
/** コンタミ加算の倍率：1マス=1倍、2マス=1.5倍、3マス=2倍… の増分（1マスあたり+0.5） */
const CONTAMINATION_MULTIPLIER_PER_EXTRA_CELL = 0.5;

class HandGridController {
    constructor() {
        // DOM要素
        this.startBtn = document.getElementById('start-btn');
        this.startContainer = document.getElementById('start-container');
        this.backToStartBtn = document.getElementById('back-to-start-btn');
        this.loadingScreen = document.getElementById('loading-screen');
        this.gridCells = document.querySelectorAll('.grid-cell');
        this.objectDragLayer = document.getElementById('object-drag-layer');
        this.protocolInstruction = document.getElementById('protocol-instruction');
        this.protocolClear = document.getElementById('protocol-clear');
        this.protocolFailed = document.getElementById('protocol-failed');
        
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
        /** 実験プロトコル状態 */
        this.protocolState = 'Phase1_Step1';
        /** コンタミネーションスコア（蓋が開いているときに手がboxの上にあると上昇） */
        this.contaminationScore = 0;
        
        // モジュール
        this.handTracker = null;
        this.gestureRecognizer = new GestureRecognizer();
        
        // グリッド設定（Start 押下時に grid-size-select から読み取り）
        this.gridCols = 3;
        this.gridRows = 3;
        
        // 初期化
        this.init();
    }
    
    /** 総セル数 */
    get totalCells() {
        return this.gridRows * this.gridCols;
    }

    /** 左上の角のセルインデックス（常に 0: row=0, col=0） */
    getTopLeftCellIndex() {
        return 0;
    }

    /** 左下の角のセルインデックス（row=最下段, col=0） */
    getBottomLeftCellIndex() {
        return (this.gridRows - 1) * this.gridCols;
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
        const cellW = window.innerWidth / this.gridCols;
        const cellH = window.innerHeight / this.gridRows;
        const size = Math.min(cellW, cellH) * OBJECT_CELL_RATIO;
        return Math.max(24, Math.floor(size)); // 最小24px
    }

    /** 3×3ブロックの幅・高さ（px）。cover のサイズ維持用。 */
    get3x3BlockSizePx() {
        const N = this.gridCols;
        return {
            width: (window.innerWidth * 3) / N,
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
        const x = (1 - (col + 0.5) / this.gridCols) * window.innerWidth;
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
        // 鏡像: getCellCenterPx では col 0 = 画面右 (x≈W)。なので clientX が大きいほど col は小さい
        const col = Math.max(0, Math.min(this.gridCols - 1, Math.floor((1 - clientX / W) * this.gridCols)));
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
        const W = window.innerWidth;
        const H = window.innerHeight;
        const N = this.gridCols;
        const R = this.gridRows;
        const left = (1 - (startCol + 3) / N) * W;
        const top = (startRow / R) * H;
        return { left, top };
    }

    /**
     * 手のひら中心が載っている cover コンテナを返す（どちらにも載っていなければ null）
     * @param {{ x: number, y: number }} palmCenter
     * @returns {HTMLElement | null}
     */
    getCoverContainerUnderPalm(palmCenter) {
        const clientX = (1 - palmCenter.x) * window.innerWidth;
        const clientY = palmCenter.y * window.innerHeight;
        for (const id of ['cover-container', 'cover-container-2']) {
            const container = document.getElementById(id);
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
        const N = this.gridCols;
        if (N < 3) return null;
        const colStart = N >= 4 ? 2 : 0;
        const leftPct = (100 * colStart) / N;
        const topPct = (100 * (N - 3)) / N;
        const sizePct = (100 * 3) / N;
        const W = window.innerWidth;
        const H = window.innerHeight;
        return {
            left: (leftPct / 100) * W,
            top: (topPct / 100) * H,
            width: (sizePct / 100) * W,
            height: (sizePct / 100) * H
        };
    }

    /**
     * 2つ目の box の 3×3 領域（セル75,76,77,85,86,87,95,96,97＝下3行・左から6〜8列目）を viewport px で返す。
     * @returns {{ left: number, top: number, width: number, height: number } | null}
     */
    getBox2RectPx() {
        const N = this.gridCols;
        if (N < 3) return null;
        const colStart = N >= 4 ? 5 : 0;
        const leftPct = (100 * colStart) / N;
        const topPct = (100 * (N - 3)) / N;
        const sizePct = (100 * 3) / N;
        const W = window.innerWidth;
        const H = window.innerHeight;
        return {
            left: (leftPct / 100) * W,
            top: (topPct / 100) * H,
            width: (sizePct / 100) * W,
            height: (sizePct / 100) * H
        };
    }

    /** 2つ目の box のセルインデックス一覧（75,76,77,85,86,87,95,96,97） */
    getBox2CellIndices() {
        const N = this.gridCols;
        const R = this.gridRows;
        if (N < 3) return new Set();
        const colStart = N >= 4 ? 5 : 0;
        const rowStart = R - 3;
        const indices = new Set();
        for (let row = rowStart; row < rowStart + 3 && row < R; row++) {
            for (let col = colStart; col < colStart + 3 && col < N; col++) {
                indices.add(row * N + col);
            }
        }
        return indices;
    }

    /** 1つ目/2つ目の box の中央セルインデックス（スナップ先と一致させるため）。 */
    getBoxCenterCellIndex(boxNum) {
        const N = this.gridCols;
        const R = this.gridRows;
        if (N < 3) return null;
        const rowStart = R - 3;
        const colStart = boxNum === 2 ? (N >= 4 ? 5 : 0) : (N >= 4 ? 2 : 0);
        const centerRow = rowStart + 1;
        const centerCol = colStart + 1;
        return centerRow * N + centerCol;
    }

    /** 指定 cover の中心と対応する box のスナップ先（中央セル中心）との距離（px）。計算できないときは null。 */
    getLidDistance(coverContainerId) {
        const coverContainer = document.getElementById(coverContainerId);
        if (!coverContainer) return null;
        const boxNum = coverContainerId === 'cover-container-2' ? 2 : 1;
        const centerCellIndex = this.getBoxCenterCellIndex(boxNum);
        if (centerCellIndex == null) return null;
        const target = this.getCellCenterPx(centerCellIndex);
        const coverRect = coverContainer.getBoundingClientRect();
        const coverCenterX = coverRect.left + coverRect.width / 2;
        const coverCenterY = coverRect.top + coverRect.height / 2;
        return Math.hypot(coverCenterX - target.x, coverCenterY - target.y);
    }

    /** 指定 cover が対応する box とほぼ同じ位置にあるか */
    isLidClosedForContainer(coverContainerId) {
        const dist = this.getLidDistance(coverContainerId);
        return dist != null && dist <= 15;
    }

    /** 蓋が閉じているか（両方の cover がそれぞれの box の上にあるか） */
    isLidClosed() {
        return this.isLidClosedForContainer('cover-container') && this.isLidClosedForContainer('cover-container-2');
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
        const N = this.gridCols;
        const R = this.gridRows;
        if (N < 3) return new Set();
        const colStart = N >= 4 ? 2 : 0;
        const rowStart = R - 3;
        const indices = new Set();
        for (let row = rowStart; row < rowStart + 3 && row < R; row++) {
            for (let col = colStart; col < colStart + 3 && col < N; col++) {
                indices.add(row * N + col);
            }
        }
        return indices;
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
        const boxCells = boxNum === 2 ? this.getBox2CellIndices() : this.getBoxCellIndices();
        if (!boxCells.size || !landmarks || !landmarks.length) return 0;
        const handCellsInBox = new Set();
        for (const lm of landmarks) {
            const idx = this.getCellIndex(lm.x, lm.y);
            if (idx >= 0 && boxCells.has(idx)) handCellsInBox.add(idx);
        }
        return handCellsInBox.size;
    }

    /**
     * 腕（肘〜手首）の線分が指定矩形と重なっているか。
     * @param {Array} poseLandmarks - MediaPipe Pose ランドマーク
     * @param {boolean} isLeftArm - true=左腕, false=右腕
     * @param {{ left: number, top: number, width: number, height: number }} [rect] - 省略時は getBoxRectPx()
     * @returns {boolean}
     */
    isArmSegmentOverBox(poseLandmarks, isLeftArm, rect) {
        const boxRect = rect || this.getBoxRectPx();
        if (!boxRect || !poseLandmarks || poseLandmarks.length < 33) return false;
        const W = window.innerWidth;
        const H = window.innerHeight;
        const [iElbow, iWrist] = isLeftArm ? [13, 15] : [14, 16];
        const nx1 = poseLandmarks[iElbow].x, ny1 = poseLandmarks[iElbow].y;
        const nx2 = poseLandmarks[iWrist].x, ny2 = poseLandmarks[iWrist].y;
        const x1 = (1 - nx1) * W, y1 = ny1 * H;
        const x2 = (1 - nx2) * W, y2 = ny2 * H;
        const left = boxRect.left, right = boxRect.left + boxRect.width;
        const top = boxRect.top, bottom = boxRect.top + boxRect.height;
        const inRect = (px, py) => px >= left && px <= right && py >= top && py <= bottom;
        if (inRect(x1, y1) || inRect(x2, y2)) return true;
        const steps = 24;
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const px = x1 + t * (x2 - x1);
            const py = y1 + t * (y2 - y1);
            if (inRect(px, py)) return true;
        }
        return false;
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

        try {
            // グリッドサイズをスタートメニューから取得（3〜10にクランプ）
            const sizeSelect = document.getElementById('grid-size-select');
            const n = Math.min(10, Math.max(3, parseInt(sizeSelect ? sizeSelect.value : '3', 10) || 3));
            this.gridCols = n;
            this.gridRows = n;

            this.buildGridDOM();

            await this.handTracker.startWebcam();
            this.isRunning = true;
            this.startContainer.classList.add('hidden');
            if (this.backToStartBtn) this.backToStartBtn.classList.remove('hidden');
            document.body.classList.remove('before-start');
            
            const experimentToggle = document.getElementById('experiment-mode-toggle');
            this.protocolEnabled = experimentToggle ? experimentToggle.checked : true;
            
            // 2Dキャンバスのサイズを設定
            this.handCanvas.width = window.innerWidth;
            this.handCanvas.height = window.innerHeight;
            
            // 実験プロトコル ON のとき、左下の角にオブジェクトを1つ配置（全グリッドサイズ対応）
            if (this.protocolEnabled) {
                this.createGridObjects([this.getBottomLeftCellIndex()]);
                this.protocolState = 'Phase1_Step1';
                this.updateProtocolUI();
            }
            if (this.protocolClear) this.protocolClear.classList.add('hidden');
            if (this.protocolFailed) this.protocolFailed.classList.add('hidden');
            
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
        const scoreEl = document.getElementById('contamination-score');
        const gaugeBar = document.getElementById('contamination-gauge-bar');
        if (scoreEl) scoreEl.textContent = '0';
        if (gaugeBar) gaugeBar.style.width = '0%';
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
                boxOverlay.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background-image:url('image/box.png')`;
                gridContainer.appendChild(boxOverlay);
                const coverContainer = document.createElement('div');
                coverContainer.id = 'cover-container';
                coverContainer.className = 'grid-cell-bg-3x3 cover-container';
                coverContainer.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
                const coverEl = document.createElement('div');
                coverEl.id = 'cover-element';
                coverEl.className = 'cover-element';
                coverEl.style.cssText = `position:absolute;left:0;top:0;width:${rect.width}px;height:${rect.height}px;background-image:url('image/cover.png');background-size:100% 100%;background-repeat:no-repeat;background-position:center`;
                coverContainer.appendChild(coverEl);
                gridContainer.appendChild(coverContainer);
            }
            // 3×3ブロック2: セル75,76,77,85,86,87,95,96,97
            const rect2 = this.getBox2RectPx();
            if (rect2) {
                const boxOverlay2 = document.createElement('div');
                boxOverlay2.className = 'grid-cell-bg-3x3';
                boxOverlay2.style.cssText = `position:fixed;left:${rect2.left}px;top:${rect2.top}px;width:${rect2.width}px;height:${rect2.height}px;background-image:url('image/box.png')`;
                gridContainer.appendChild(boxOverlay2);
                const coverContainer2 = document.createElement('div');
                coverContainer2.id = 'cover-container-2';
                coverContainer2.className = 'grid-cell-bg-3x3 cover-container';
                coverContainer2.style.cssText = `position:fixed;left:${rect2.left}px;top:${rect2.top}px;width:${rect2.width}px;height:${rect2.height}px`;
                const coverEl2 = document.createElement('div');
                coverEl2.id = 'cover-element-2';
                coverEl2.className = 'cover-element';
                coverEl2.style.cssText = `position:absolute;left:0;top:0;width:${rect2.width}px;height:${rect2.height}px;background-image:url('image/cover.png');background-size:100% 100%;background-repeat:no-repeat;background-position:center`;
                coverContainer2.appendChild(coverEl2);
                gridContainer.appendChild(coverContainer2);
            }
        }
        
        for (let i = 0; i < total; i++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.dataset.index = String(i);
            gridContainer.appendChild(cell);
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
        
        // 2Dキャンバスをクリア
        this.handCtx.clearRect(0, 0, this.handCanvas.width, this.handCanvas.height);
        
        // 全てのグリッドセルを非アクティブに（手のひら・肘〜手首）
        this.gridCells.forEach(cell => {
            cell.classList.remove('active');
            cell.classList.remove('arm-active');
        });

        // 手のトラッキング（Holistic で手＋ポーズを同時取得）
        const hands = this.handTracker.detectHands();
        const poseLandmarks = this.handTracker.getPoseLandmarks();

        // 肘〜手首の線分が通るマスを腕用色でハイライト（MediaPipe Pose: 13=左肘,15=左手首, 14=右肘,16=右手首）
        if (poseLandmarks && poseLandmarks.length >= 33) {
            const leftCells = this.getCellsOnSegment(
                poseLandmarks[13].x, poseLandmarks[13].y,
                poseLandmarks[15].x, poseLandmarks[15].y
            );
            const rightCells = this.getCellsOnSegment(
                poseLandmarks[14].x, poseLandmarks[14].y,
                poseLandmarks[16].x, poseLandmarks[16].y
            );
            [...leftCells, ...rightCells].forEach((idx) => {
                if (idx >= 0 && idx < this.totalCells && this.gridCells[idx]) {
                    this.gridCells[idx].classList.add('arm-active');
                }
            });
        }

        // ランドマーク表示時: 全身ポーズを先に描画し、その上に手を描画
        if (this.showLandmarks && poseLandmarks && poseLandmarks.length >= 33) {
            this.drawPoseLandmarks(poseLandmarks);
        }

        if (hands && hands.length > 0) {
            this.processHands(hands);
        }

        // 蓋が開いているとき、各 box ごとに手・腕がその box の上にあればスコア加算（マス数に応じて倍率）
        const boxConfigs = [
            { containerId: 'cover-container', getRect: () => this.getBoxRectPx() },
            { containerId: 'cover-container-2', getRect: () => this.getBox2RectPx() }
        ];
        for (const cfg of boxConfigs) {
            if (this.isLidClosedForContainer(cfg.containerId)) continue;
            if (hands && hands.length > 0) {
                const boxNum = cfg.containerId === 'cover-container-2' ? 2 : 1;
                for (let i = 0; i < hands.length; i++) {
                    const count = this.countHandCellsInBox(hands[i].landmarks, boxNum);
                    if (count > 0) {
                        const multiplier = 1 + (count - 1) * CONTAMINATION_MULTIPLIER_PER_EXTRA_CELL;
                        this.contaminationScore += CONTAMINATION_RATE_PER_FRAME * multiplier;
                    }
                }
            }
            if (poseLandmarks && poseLandmarks.length >= 33) {
                const rect = cfg.getRect();
                if (rect) {
                    if (this.isArmSegmentOverBox(poseLandmarks, true, rect)) this.contaminationScore += CONTAMINATION_RATE_PER_FRAME;
                    if (this.isArmSegmentOverBox(poseLandmarks, false, rect)) this.contaminationScore += CONTAMINATION_RATE_PER_FRAME;
                }
            }
        }

        // コンタミネーション表示更新
        const scoreEl = document.getElementById('contamination-score');
        const gaugeBar = document.getElementById('contamination-gauge-bar');
        if (scoreEl) scoreEl.textContent = String(Math.round(this.contaminationScore));
        if (gaugeBar) {
            const pct = Math.min(100, (Math.min(this.contaminationScore, CONTAMINATION_MAX) / CONTAMINATION_MAX) * 100);
            gaugeBar.style.width = pct + '%';
        }
        
        // 掴んだオブジェクトをそれぞれの手の位置・裏表に追従
        if (hands && Object.keys(this.heldObjects).length > 0) {
            Object.keys(this.heldObjects).forEach((key) => {
                const handIndex = parseInt(key, 10);
                const held = this.heldObjects[handIndex];
                if (hands[handIndex]) {
                    const landmarks = hands[handIndex].landmarks;
                    const gesture = this.gestureRecognizer.recognize(landmarks, handIndex);
                    const size = held.isCover ? this.get3x3BlockSizePx() : undefined;
                    this.updateHeldObjectPosition(held.element, gesture.palmCenter, size);
                    this.updateHeldObjectFlip(handIndex, hands[handIndex]);
                }
            });
        }
        
        if (this.protocolEnabled && this.protocolState !== 'PhaseDone' && this.protocolState !== 'PhaseFailed') {
            this.checkProtocolStep();
        }
        this.updateProtocolUI();
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
     * 現在ステップで期待される移動を返す。PhaseDone / PhaseFailed のときは null。
     * プロトコル: 左下 → 左上（全グリッドサイズ共通）。
     * @returns {{ initialCell: number, targetCell: number } | null}
     */
    getExpectedMoveForCurrentStep() {
        if (this.protocolState !== 'Phase1_Step1') return null;
        return {
            initialCell: this.getBottomLeftCellIndex(),
            targetCell: this.getTopLeftCellIndex()
        };
    }

    /**
     * 実験プロトコル: 現在ステップの条件を満たしていれば次へ進める（左下→左上で PhaseDone）
     */
    checkProtocolStep() {
        const cfg = this.getExpectedMoveForCurrentStep();
        if (!cfg) return;
        for (let ci = 0; ci < this.totalCells; ci++) {
            const arr = this.cellObjects[ci] || [];
            for (const el of arr) {
                const initial = parseInt(el.dataset.initialCell, 10);
                if (initial !== cfg.initialCell) continue;
                const current = this.getCellOfObject(el);
                if (current === cfg.targetCell) {
                    this.protocolState = 'PhaseDone';
                    if (this.protocolClear) this.protocolClear.classList.remove('hidden');
                    return;
                }
            }
        }
    }
    
    /** プロトコル指示テキストとクリア表示の更新 */
    updateProtocolUI() {
        if (!this.protocolEnabled) {
            if (this.protocolInstruction) this.protocolInstruction.textContent = '';
            return;
        }
        const labels = {
            Phase1_Step1: '左下 → 左上 に移動',
            PhaseDone: '',
            PhaseFailed: ''
        };
        if (this.protocolInstruction) {
            this.protocolInstruction.textContent = labels[this.protocolState] || '';
        }
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
        const w = window.innerWidth;
        const h = window.innerHeight;
        const sizeW = explicitSize ? explicitSize.width : (element.offsetWidth || this.getObjectSize());
        const sizeH = explicitSize ? explicitSize.height : (element.offsetHeight || this.getObjectSize());
        const flippedX = 1 - palmCenter.x;
        const left = flippedX * w - sizeW / 2;
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
                    } else if (cellIndex >= 0 && cellIndex < this.totalCells) {
                        if (this.protocolEnabled && this.protocolState !== 'PhaseDone' && this.protocolState !== 'PhaseFailed') {
                            const el = this.heldObjects[handIndex].element;
                            const initialCell = parseInt(el.dataset.initialCell, 10);
                            const expected = this.getExpectedMoveForCurrentStep();
                            if (expected && (initialCell !== expected.initialCell || cellIndex !== expected.targetCell)) {
                                this.protocolState = 'PhaseFailed';
                                if (this.protocolFailed) this.protocolFailed.classList.remove('hidden');
                            }
                        }
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
        // 左右反転を考慮（カメラは反転表示）
        const flippedX = 1 - x;
        
        // 座標をグリッドのセルに変換
        const col = Math.floor(flippedX * this.gridCols);
        const row = Math.floor(y * this.gridRows);
        
        // 範囲チェック
        if (col < 0 || col >= this.gridCols || row < 0 || row >= this.gridRows) {
            return -1;
        }
        
        // インデックスを計算（左上が0、右下が totalCells-1）
        return row * this.gridCols + col;
    }

    /**
     * 正規化座標の線分が通るグリッドセルのインデックスを返す（肘〜手首の可視化用）。
     * @param {number} x1 - 始点の正規化X (0-1)
     * @param {number} y1 - 始点の正規化Y (0-1)
     * @param {number} x2 - 終点の正規化X (0-1)
     * @param {number} y2 - 終点の正規化Y (0-1)
     * @returns {number[]} セルインデックスの配列（重複なし）
     */
    getCellsOnSegment(x1, y1, x2, y2) {
        const indices = new Set();
        const steps = 20;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = x1 + (x2 - x1) * t;
            const y = y1 + (y2 - y1) * t;
            const idx = this.getCellIndex(x, y);
            if (idx >= 0) indices.add(idx);
        }
        return [...indices];
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

    /**
     * MediaPipe 全身ポーズランドマーク（33点）を2Dキャンバスに描画
     * @param {Array} landmarks - poseLandmarks（正規化座標 x, y, z）
     */
    drawPoseLandmarks(landmarks) {
        const ctx = this.handCtx;
        const w = this.handCanvas.width;
        const h = this.handCanvas.height;

        // MediaPipe Pose 33点の接続（骨格線）
        const POSE_CONNECTIONS = [
            [0, 1], [1, 2], [2, 3], [3, 7],   // 左目〜左耳
            [0, 4], [4, 5], [5, 6], [6, 8],   // 右目〜右耳
            [9, 10],                            // 口
            [11, 12],                           // 肩
            [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],  // 左腕〜左手
            [12, 14], [14, 16], [16, 18], [16, 20], [16, 22],  // 右腕〜右手
            [11, 23], [12, 24], [23, 24],      // 胴体
            [23, 25], [25, 27], [27, 29], [27, 31],  // 左足
            [24, 26], [26, 28], [28, 30], [28, 32]   // 右足
        ];

        // 骨格線を描画
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)';
        ctx.lineWidth = 2;
        POSE_CONNECTIONS.forEach(([start, end]) => {
            const p1 = landmarks[start];
            const p2 = landmarks[end];
            if (!p1 || !p2) return;
            ctx.beginPath();
            ctx.moveTo(p1.x * w, p1.y * h);
            ctx.lineTo(p2.x * w, p2.y * h);
            ctx.stroke();
        });

        // 各関節を描画
        landmarks.forEach((lm, idx) => {
            const x = lm.x * w;
            const y = lm.y * h;
            let color = '#22c55e';
            if (idx <= 10) color = '#a78bfa';   // 顔
            else if (idx <= 22) color = '#38bdf8'; // 腕・肩
            else color = '#f59e0b';              // 脚
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        });
    }
    
    hideLoadingScreen() {
        if (this.loadingScreen) {
            this.loadingScreen.classList.add('hidden');
        }
    }
    
    onResize() {
        this.handCanvas.width = window.innerWidth;
        this.handCanvas.height = window.innerHeight;
    }
}

// 起動
window.addEventListener('DOMContentLoaded', () => {
    window.app = new HandGridController();
});
