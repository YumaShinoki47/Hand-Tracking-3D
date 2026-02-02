/**
 * Hand Grid Controller - Main Application
 * ========================================
 * 画面を9分割し、マス内のオブジェクトをグーで掴み・パーで離す
 */

import { HandTracker } from './handTracking.js';
import { GestureRecognizer, GESTURE_TYPES } from './gestures.js';

const OBJECT_SIZE = 70; // 四角オブジェクトのサイズ（px）

class HandGridController {
    constructor() {
        // DOM要素
        this.startBtn = document.getElementById('start-btn');
        this.startContainer = document.getElementById('start-container');
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
        /** @type {Object.<number, { element: HTMLElement, fromCellIndex: number }>} 手インデックス → 掴んでいるオブジェクト */
        this.heldObjects = {};
        
        // モジュール
        this.handTracker = null;
        this.gestureRecognizer = new GestureRecognizer();
        
        // グリッド設定（3x3）
        this.gridCols = 3;
        this.gridRows = 3;
        
        // 初期化
        this.init();
    }
    
    async init() {
        try {
            // ハンドトラッキング初期化
            this.handTracker = new HandTracker();
            await this.handTracker.init();
            
            // イベントリスナー
            this.startBtn.addEventListener('click', () => this.start());
            window.addEventListener('resize', () => this.onResize());
            
            // ランドマーク表示トグル
            this.landmarkToggle.addEventListener('change', (e) => {
                this.showLandmarks = e.target.checked;
                if (!this.showLandmarks) {
                    this.handCtx.clearRect(0, 0, this.handCanvas.width, this.handCanvas.height);
                }
            });
            
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
        
        try {
            await this.handTracker.startWebcam();
            this.isRunning = true;
            this.startContainer.classList.add('hidden');
            
            // 2Dキャンバスのサイズを設定
            this.handCanvas.width = window.innerWidth;
            this.handCanvas.height = window.innerHeight;
            
            // マス内に四角オブジェクトを配置（セル0とセル4に1つずつ）
            this.createGridObjects([0, 4]);
            
            this.animate();
        } catch (error) {
            console.error('Failed to start:', error);
        }
    }
    
    animate() {
        if (!this.isRunning) return;
        
        requestAnimationFrame(() => this.animate());
        
        // 2Dキャンバスをクリア
        this.handCtx.clearRect(0, 0, this.handCanvas.width, this.handCanvas.height);
        
        // 全てのグリッドセルを非アクティブに
        this.gridCells.forEach(cell => cell.classList.remove('active'));
        
        // 手のトラッキング
        const hands = this.handTracker.detectHands();
        
        if (hands && hands.length > 0) {
            this.processHands(hands);
        }
        
        // 掴んだオブジェクトをそれぞれの手の位置に追従
        if (hands && Object.keys(this.heldObjects).length > 0) {
            Object.keys(this.heldObjects).forEach((key) => {
                const handIndex = parseInt(key, 10);
                if (hands[handIndex]) {
                    const gesture = this.gestureRecognizer.recognize(hands[handIndex].landmarks, handIndex);
                    this.updateHeldObjectPosition(this.heldObjects[handIndex].element, gesture.palmCenter);
                }
            });
        }
    }
    
    /**
     * 指定したセルに四角オブジェクトを配置
     * @param {number[]} cellIndices - オブジェクトを置くセルのインデックス
     */
    createGridObjects(cellIndices) {
        cellIndices.forEach((cellIndex) => {
            const el = document.createElement('div');
            el.className = 'grid-object';
            el.style.width = OBJECT_SIZE + 'px';
            el.style.height = OBJECT_SIZE + 'px';
            this.gridCells[cellIndex].appendChild(el);
            this.cellObjects[cellIndex] = [el];
        });
    }
    
    /**
     * 掴んでいるオブジェクトの表示位置を手のひらに合わせて更新
     * @param {HTMLElement} element - 対象のオブジェクト要素
     * @param {{ x: number, y: number }} palmCenter - 手のひらの正規化座標
     */
    updateHeldObjectPosition(element, palmCenter) {
        if (!element) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        const flippedX = 1 - palmCenter.x;
        const left = flippedX * w - OBJECT_SIZE / 2;
        const top = palmCenter.y * h - OBJECT_SIZE / 2;
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
            if (cellIndex >= 0 && cellIndex < 9) {
                this.gridCells[cellIndex].classList.add('active');
            }

            // グー: この手で掴む（この手がまだ何も持っていない & マスにオブジェクトが1つ以上ある）
            if (gesture.type === GESTURE_TYPES.FIST) {
                const arr = this.cellObjects[cellIndex];
                if (!this.heldObjects[handIndex] && cellIndex >= 0 && arr && arr.length > 0) {
                    this.grabObject(handIndex, cellIndex, palmCenter);
                }
            }
            // パー: この手で離す
            if (gesture.type === GESTURE_TYPES.OPEN) {
                if (this.heldObjects[handIndex] && cellIndex >= 0 && cellIndex < 9) {
                    this.dropObject(handIndex, cellIndex);
                }
            }
        });
    }
    
    /** 指定した手で指定セルのオブジェクトを1つ掴む（同じマスに複数ある場合は最後に置いたもの＝手前） */
    grabObject(handIndex, cellIndex, palmCenter) {
        const arr = this.cellObjects[cellIndex];
        if (!arr || arr.length === 0) return;
        const el = arr.pop();
        if (arr.length === 0) delete this.cellObjects[cellIndex];
        el.remove();
        this.objectDragLayer.appendChild(el);
        el.classList.add('held');
        this.heldObjects[handIndex] = { element: el, fromCellIndex: cellIndex };
        this.updateHeldObjectPosition(el, palmCenter);
    }
    
    /** 指定した手で掴んでいるオブジェクトを指定セルに置く */
    dropObject(handIndex, cellIndex) {
        const held = this.heldObjects[handIndex];
        if (!held) return;
        const el = held.element;
        el.classList.remove('held');
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
     * @returns {number} セルインデックス (0-8)
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
        
        // インデックスを計算（左上が0、右下が8）
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
    }
}

// 起動
window.addEventListener('DOMContentLoaded', () => {
    window.app = new HandGridController();
});
