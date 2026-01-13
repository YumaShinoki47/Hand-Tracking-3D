/**
 * Hand Magic Studio - Hand Tracking Module
 * =========================================
 * MediaPipe Hand Landmarker を使用した手の検出
 */

export class HandTracker {
    constructor() {
        this.videoEl = document.getElementById('webcam');
        this.handLandmarker = null;
        this.lastVideoTime = -1;
        this.lastResult = null;
        this.isInitialized = false;
        this.isWebcamRunning = false;
        
        // スムージング用
        this.smoothingFactor = 1.0;
        this.prevLandmarks = new Map();
    }
    
    /**
     * MediaPipe Hand Landmarker を初期化
     */
    async init() {
        try {
            console.log('📦 Loading MediaPipe...');
            
            // esm.sh CDNを使用してESMモジュールとして読み込む
            const { FilesetResolver, HandLandmarker } = await import(
                'https://esm.sh/@mediapipe/tasks-vision@0.10.0'
            );
            
            console.log('✅ MediaPipe module loaded');
            
            const vision = await FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
            );
            
            console.log('✅ Vision tasks loaded');
            
            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
                    delegate: 'GPU'
                },
                runningMode: 'VIDEO',
                numHands: 2,
                minHandDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5,
                minHandPresenceConfidence: 0.5
            });
            
            this.isInitialized = true;
            console.log('✨ Hand Landmarker initialized successfully');
            return true;
            
        } catch (error) {
            console.error('❌ Failed to initialize Hand Landmarker:', error);
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
            
            // ビデオを明示的に再生
            await this.videoEl.play();
            
            console.log('📷 Webcam started');
            return true;
            
        } catch (error) {
            console.error('❌ Failed to start webcam:', error);
            throw error;
        }
    }
    
    /**
     * Webカメラを停止
     */
    stopWebcam() {
        if (this.videoEl.srcObject) {
            this.videoEl.srcObject.getTracks().forEach(track => track.stop());
            this.videoEl.srcObject = null;
        }
        this.isWebcamRunning = false;
    }
    
    /**
     * 手を検出
     * @returns {Array|null} 検出された手の情報
     */
    detectHands() {
        if (!this.handLandmarker || !this.isWebcamRunning) {
            return null;
        }
        
        if (!this.videoEl.videoWidth || !this.videoEl.videoHeight) {
            return null;
        }
        
        const currentTime = this.videoEl.currentTime;
        
        // 同じフレームならキャッシュを返す
        if (currentTime === this.lastVideoTime) {
            return this.lastResult;
        }
        
        this.lastVideoTime = currentTime;
        
        try {
            const result = this.handLandmarker.detectForVideo(
                this.videoEl,
                performance.now()
            );
            
            if (result.landmarks && result.landmarks.length > 0) {
                this.lastResult = result.landmarks.map((landmarks, index) => {
                    // スムージング適用
                    const smoothedLandmarks = this.smoothLandmarks(landmarks, index);
                    
                    return {
                        landmarks: smoothedLandmarks,
                        worldLandmarks: result.worldLandmarks?.[index] || null,
                        handedness: result.handednesses?.[index]?.[0]?.categoryName || 'Unknown',
                        handednessScore: result.handednesses?.[index]?.[0]?.score || 0
                    };
                });
            } else {
                this.lastResult = null;
                this.prevLandmarks.clear();
            }
            
            return this.lastResult;
            
        } catch (error) {
            console.error('Detection error:', error);
            return null;
        }
    }
    
    /**
     * ランドマークをスムージング
     * @param {Array} landmarks - 現在のランドマーク
     * @param {number} handIndex - 手のインデックス
     * @returns {Array} スムージングされたランドマーク
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
     * 手の数を取得
     * @returns {number}
     */
    getHandCount() {
        return this.lastResult ? this.lastResult.length : 0;
    }
    
    /**
     * 特定のランドマークを取得
     * @param {number} handIndex - 手のインデックス
     * @param {number} landmarkIndex - ランドマークのインデックス
     * @returns {Object|null} ランドマーク座標
     */
    getLandmark(handIndex, landmarkIndex) {
        if (!this.lastResult || !this.lastResult[handIndex]) {
            return null;
        }
        return this.lastResult[handIndex].landmarks[landmarkIndex] || null;
    }
    
    /**
     * 手全体のランドマークを取得
     * @param {number} handIndex - 手のインデックス
     * @returns {Array|null} ランドマーク配列
     */
    getHandLandmarks(handIndex) {
        if (!this.lastResult || !this.lastResult[handIndex]) {
            return null;
        }
        return this.lastResult[handIndex].landmarks;
    }
    
    /**
     * リソースをクリーンアップ
     */
    dispose() {
        this.stopWebcam();
        if (this.handLandmarker) {
            this.handLandmarker.close();
            this.handLandmarker = null;
        }
        this.prevLandmarks.clear();
        this.isInitialized = false;
    }
}
