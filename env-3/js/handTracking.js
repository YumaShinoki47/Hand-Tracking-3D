/**
 * Hand Grid Controller - Holistic Tracking Module
 * ================================================
 * MediaPipe Holistic Landmarker を使用（手＋全身ポーズを単一パイプラインで検出）。
 * 手の出力形式は従来の detectHands() と互換を保ち、指トラッキング・グー/パー認識を維持。
 */

export class HandTracker {
    constructor() {
        this.videoEl = document.getElementById('webcam');
        this.holisticLandmarker = null;
        this.lastVideoTime = -1;
        this.lastHandResult = null;
        this.lastPoseResult = null;
        this.lastPoseWorldResult = null;
        this.isInitialized = false;
        this.isWebcamRunning = false;

        // スムージング用（1.0 = スムージングなし）
        this.smoothingFactor = 0.8;
        this.prevLandmarks = new Map();
    }

    /**
     * MediaPipe Holistic Landmarker を初期化（手＋ポーズを一括検出）
     */
    async init() {
        try {
            console.log('📦 Loading MediaPipe Holistic...');

            const { FilesetResolver, HolisticLandmarker } = await import(
                'https://esm.sh/@mediapipe/tasks-vision@0.10.32'
            );

            console.log('✅ MediaPipe module loaded');

            const vision = await FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm'
            );

            console.log('✅ Vision tasks loaded');

            this.holisticLandmarker = await HolisticLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task',
                    delegate: 'GPU'
                },
                runningMode: 'VIDEO'
            });

            this.isInitialized = true;
            console.log('✨ Holistic Landmarker initialized successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Holistic Landmarker:', error);
            throw error;
        }
    }

    /**
     * Webカメラを起動
     */
    async startWebcam() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                },
                audio: false
            });

            this.videoEl.srcObject = stream;

            await new Promise((resolve) => {
                this.videoEl.onloadeddata = () => {
                    this.isWebcamRunning = true;
                    resolve();
                };
            });

            await this.videoEl.play();

            console.log('📷 Webcam started');
            return true;
        } catch (error) {
            console.error('❌ Failed to start webcam:', error);
            throw error;
        }
    }

    /**
     * 手を検出（Holistic の left/right を既存アプリと同じ形式で返す）
     * @returns {Array|null} 検出された手の情報 [{ landmarks, worldLandmarks, handedness }, ...]
     */
    detectHands() {
        if (!this.holisticLandmarker || !this.isWebcamRunning) {
            return null;
        }

        if (!this.videoEl.videoWidth || !this.videoEl.videoHeight) {
            return null;
        }

        const currentTime = this.videoEl.currentTime;

        if (currentTime === this.lastVideoTime) {
            return this.lastHandResult;
        }

        this.lastVideoTime = currentTime;

        try {
            const result = this.holisticLandmarker.detectForVideo(
                this.videoEl,
                performance.now()
            );

            this.lastPoseResult = result.poseLandmarks && result.poseLandmarks.length > 0
                ? result.poseLandmarks
                : null;
            if (result.poseWorldLandmarks && result.poseWorldLandmarks.length > 0) {
                this.lastPoseWorldResult = result.poseWorldLandmarks;
            } else {
                this.lastPoseWorldResult = null;
            }

            const hands = [];
            // Holistic は leftHandLandmarks が「手の配列」なので先頭要素が21点
            const leftLandmarks = result.leftHandLandmarks?.[0];
            const rightLandmarks = result.rightHandLandmarks?.[0];
            const leftWorld = result.leftHandWorldLandmarks?.[0] ?? null;
            const rightWorld = result.rightHandWorldLandmarks?.[0] ?? null;

            if (leftLandmarks && leftLandmarks.length >= 21) {
                const smoothed = this.smoothLandmarks(leftLandmarks, 0);
                hands.push({
                    landmarks: smoothed,
                    worldLandmarks: leftWorld,
                    handedness: 'Left',
                    handednessScore: 1
                });
            }
            if (rightLandmarks && rightLandmarks.length >= 21) {
                const smoothed = this.smoothLandmarks(rightLandmarks, 1);
                hands.push({
                    landmarks: smoothed,
                    worldLandmarks: rightWorld,
                    handedness: 'Right',
                    handednessScore: 1
                });
            }

            if (hands.length > 0) {
                this.lastHandResult = hands;
            } else {
                this.lastHandResult = null;
                this.prevLandmarks.clear();
            }

            return this.lastHandResult;
        } catch (error) {
            console.error('Detection error:', error);
            return null;
        }
    }

    /**
     * 全身ポーズランドマークを取得（33点）。描画などに利用可能。
     * @returns {Array|null} poseLandmarks または null
     */
    getPoseLandmarks() {
        return this.lastPoseResult ?? null;
    }

    /**
     * ランドマークをスムージング
     */
    smoothLandmarks(landmarks, handIndex) {
        const prev = this.prevLandmarks.get(handIndex);

        if (!prev) {
            this.prevLandmarks.set(handIndex, [...landmarks]);
            return landmarks;
        }

        const smoothed = landmarks.map((lm, idx) => {
            const prevLm = prev[idx];
            if (!prevLm) return lm;

            return {
                x: prevLm.x * (1 - this.smoothingFactor) + lm.x * this.smoothingFactor,
                y: prevLm.y * (1 - this.smoothingFactor) + lm.y * this.smoothingFactor,
                z: prevLm.z * (1 - this.smoothingFactor) + lm.z * this.smoothingFactor
            };
        });

        this.prevLandmarks.set(handIndex, smoothed);
        return smoothed;
    }

    /**
     * リソースをクリーンアップ
     */
    dispose() {
        if (this.videoEl.srcObject) {
            this.videoEl.srcObject.getTracks().forEach(track => track.stop());
            this.videoEl.srcObject = null;
        }
        if (this.holisticLandmarker) {
            this.holisticLandmarker.close();
            this.holisticLandmarker = null;
        }
        this.prevLandmarks.clear();
        this.lastPoseResult = null;
        this.lastPoseWorldResult = null;
        this.isInitialized = false;
    }
}
