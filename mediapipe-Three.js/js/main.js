/**
 * Hand Magic Studio - Main Application (Simplified)
 * ==================================================
 * パー → 散らばる / グー → 集まる
 */

import * as THREE from 'three';
import { HandTracker } from './handTracking.js';
import { GestureRecognizer, GESTURE_TYPES } from './gestures.js';
import { MagicParticleField } from './effects.js';
import { normalizedToWorld } from './utils.js';

class HandMagicStudio {
    constructor() {
        // DOM要素
        this.canvas = document.getElementById('three-canvas');
        this.startBtn = document.getElementById('start-btn');
        this.startContainer = document.getElementById('start-container');
        this.loadingScreen = document.getElementById('loading-screen');
        
        // 状態
        this.isRunning = false;
        this.isInitialized = false;
        
        // モジュール
        this.handTracker = null;
        this.gestureRecognizer = null;
        this.magicField = null;
        
        // 2D手描画
        this.handCanvas = document.getElementById('hand-canvas');
        this.handCtx = this.handCanvas.getContext('2d');
        this.showLandmarks = false;  // ランドマーク表示フラグ（デフォルトOFF）
        this.landmarkToggle = document.getElementById('landmark-toggle');
        
        // 初期化
        this.init();
    }
    
    async init() {
        try {
            // Three.jsセットアップ
            this.setupThreeJS();
            
            // ハンドトラッキング初期化
            this.handTracker = new HandTracker();
            await this.handTracker.init();
            
            // ジェスチャー認識
            this.gestureRecognizer = new GestureRecognizer();
            
            // マジックパーティクルフィールド
            this.magicField = new MagicParticleField(this.scene);
            
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
            
            console.log('✨ Hand Magic Studio initialized');
            
        } catch (error) {
            console.error('❌ Initialization failed:', error);
            this.hideLoadingScreen();
        }
    }
    
    setupThreeJS() {
        // シーン - 透明背景（カメラ映像が見える）
        this.scene = new THREE.Scene();
        
        // カメラ
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 0, 5);
        
        // レンダラー（透明背景）
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true
        });
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
            
            this.animate();
        } catch (error) {
            console.error('Failed to start:', error);
        }
    }
    
    animate() {
        if (!this.isRunning) return;
        
        requestAnimationFrame(() => this.animate());
        
        // 手のトラッキング
        const hands = this.handTracker.detectHands();
        
        // 2Dキャンバスをクリア
        this.handCtx.clearRect(0, 0, this.handCanvas.width, this.handCanvas.height);
        
        if (hands && hands.length > 0) {
            this.processHands(hands);
        } else {
            // 手がなくなったら散らばる
            this.magicField.scatter();
        }
        
        // パーティクル更新
        this.magicField.update();
        
        // レンダリング
        this.renderer.render(this.scene, this.camera);
    }
    
    processHands(hands) {
        hands.forEach((hand, index) => {
            const landmarks = hand.landmarks;
            
            // 動的なスケール計算（object-fit: cover対応）
            const videoEl = this.handTracker.videoEl;
            const videoAspect = videoEl.videoWidth / videoEl.videoHeight;
            const screenAspect = window.innerWidth / window.innerHeight;
            
            // 基本スケール（Three.jsのワールド座標用）
            const baseScale = 8;
            let scaleX, scaleY;
            let offsetX = 0, offsetY = 0;
            
            if (videoAspect > screenAspect) {
                // ビデオが横長 → 左右がクリップされる
                scaleY = baseScale / screenAspect;
                scaleX = scaleY * screenAspect;
                const visibleWidthRatio = screenAspect / videoAspect;
                const clipRatio = (1 - visibleWidthRatio) / 2;
                offsetX = clipRatio;
            } else {
                // ビデオが縦長 → 上下がクリップされる
                scaleX = baseScale;
                scaleY = scaleX / screenAspect;
                const visibleHeightRatio = videoAspect / screenAspect;
                const clipRatio = (1 - visibleHeightRatio) / 2;
                offsetY = clipRatio;
            }
            
            // ワールド座標変換（クリップ補正付き）
            const toWorld = (lm) => {
                const adjustedX = (lm.x - offsetX) / (1 - 2 * offsetX);
                const adjustedY = (lm.y - offsetY) / (1 - 2 * offsetY);
                return {
                    x: (adjustedX - 0.5) * -scaleX,
                    y: -(adjustedY - 0.5) * scaleY,
                    z: -lm.z * 4
                };
            };
            
            // MediaPipeのランドマークを2Dキャンバスに直接描画
            if (this.showLandmarks) {
                this.drawHandLandmarks(landmarks);
            }
            
            // 最初の手だけでパーティクルを制御
            if (index === 0) {
                // ジェスチャー認識
                const gesture = this.gestureRecognizer.recognize(landmarks, 0);
                
                // ジェスチャーに応じてパーティクルを制御
                if (gesture.type === GESTURE_TYPES.FIST) {
                    // グー → グーの位置に集まる
                    const palmWorld = toWorld(gesture.palmCenter);
                    const handPos = new THREE.Vector3(palmWorld.x, palmWorld.y, palmWorld.z);
                    
                    const state = this.magicField.getState();
                    if (state === 'scattered') {
                        // 散らばっている状態から集合開始
                        this.magicField.gather(handPos);
                    } else {
                        // 集合中または集合済みなら位置を更新
                        this.magicField.updateGatherCenter(handPos);
                    }
                } else if (gesture.type === GESTURE_TYPES.OPEN) {
                    // パー → 散らばる
                    this.magicField.scatter();
                }
            }
        });
    }
    
    /**
     * MediaPipeのランドマークを2Dキャンバスに直接描画
     */
    drawHandLandmarks(landmarks) {
        const ctx = this.handCtx;
        const w = this.handCanvas.width;
        const h = this.handCanvas.height;
        
        // 接続情報
        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4],       // 親指
            [0, 5], [5, 6], [6, 7], [7, 8],       // 人差し指
            [0, 9], [9, 10], [10, 11], [11, 12],  // 中指
            [0, 13], [13, 14], [14, 15], [15, 16], // 薬指
            [0, 17], [17, 18], [18, 19], [19, 20], // 小指
            [5, 9], [9, 13], [13, 17]              // 手のひら
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
            
            // 色を指ごとに変える
            let color = '#8b5cf6';
            if (idx >= 1 && idx <= 4) color = '#f472b6';      // 親指
            else if (idx >= 5 && idx <= 8) color = '#22d3ee';  // 人差し指
            else if (idx >= 9 && idx <= 12) color = '#4ade80'; // 中指
            else if (idx >= 13 && idx <= 16) color = '#fbbf24'; // 薬指
            else if (idx >= 17 && idx <= 20) color = '#f87171'; // 小指
            
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
        });
    }
    
    /**
     * ランドマーク表示をトグル
     */
    toggleLandmarks() {
        this.showLandmarks = !this.showLandmarks;
        this.landmarkToggle.classList.toggle('active', this.showLandmarks);
        
        // OFFの場合はキャンバスをクリア
        if (!this.showLandmarks) {
            this.handCtx.clearRect(0, 0, this.handCanvas.width, this.handCanvas.height);
        }
    }
    
    hideLoadingScreen() {
        if (this.loadingScreen) {
            this.loadingScreen.classList.add('hidden');
        }
    }
    
    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        
        // 2Dキャンバスもリサイズ
        this.handCanvas.width = window.innerWidth;
        this.handCanvas.height = window.innerHeight;
    }
}

// 起動
window.addEventListener('DOMContentLoaded', () => {
    window.app = new HandMagicStudio();
});
