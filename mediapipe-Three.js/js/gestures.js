/**
 * Hand Magic Studio - Gesture Recognition Module
 * ===============================================
 * ランドマークからジェスチャーを認識
 */

import { HAND_LANDMARKS, distance2D } from './utils.js';

/**
 * ジェスチャータイプ
 */
export const GESTURE_TYPES = {
    NONE: 'NONE',
    OPEN: 'OPEN',
    PINCH: 'PINCH',
    FIST: 'FIST',
    PEACE: 'PEACE',
    THUMBS_UP: 'THUMBS_UP',
    POINTING: 'POINTING',
    ROCK: 'ROCK'
};

export class GestureRecognizer {
    constructor() {
        // ヒステリシス用の状態
        this.prevGestures = new Map();
        
        // ピンチ閾値
        this.pinchStartThreshold = 0.06;
        this.pinchEndThreshold = 0.10;
        
        // 指の伸び判定閾値
        this.fingerExtendedThreshold = 0.15;
        
        // デバウンス用
        this.gestureHistory = new Map();
        this.historySize = 3;
    }
    
    /**
     * ジェスチャーを認識
     * @param {Array} landmarks - 21個のランドマーク
     * @param {number} handIndex - 手のインデックス
     * @returns {Object} ジェスチャー情報
     */
    recognize(landmarks, handIndex = 0) {
        if (!landmarks || landmarks.length < 21) {
            return { type: GESTURE_TYPES.NONE, confidence: 0 };
        }
        
        // 各指の状態を取得
        const fingerStates = this.getFingerStates(landmarks);
        
        // ピンチ距離を計算
        const pinchDistance = this.getPinchDistance(landmarks);
        
        // ジェスチャーを判定
        let gesture = this.classifyGesture(fingerStates, pinchDistance, handIndex);
        
        // ヒステリシス適用
        gesture = this.applyHysteresis(gesture, handIndex);
        
        // 追加情報を付与
        gesture.pinchDistance = pinchDistance;
        gesture.fingerStates = fingerStates;
        gesture.pinchCenter = this.getPinchCenter(landmarks);
        gesture.palmCenter = this.getPalmCenter(landmarks);
        
        return gesture;
    }
    
    /**
     * 各指の状態を取得
     * @param {Array} landmarks - ランドマーク
     * @returns {Object} 指の状態
     */
    getFingerStates(landmarks) {
        const wrist = landmarks[HAND_LANDMARKS.WRIST];
        
        // 各指の先端とMCP（付け根）の関係で判定
        const states = {
            thumb: this.isThumbExtended(landmarks),
            index: this.isFingerExtended(landmarks, 'INDEX'),
            middle: this.isFingerExtended(landmarks, 'MIDDLE'),
            ring: this.isFingerExtended(landmarks, 'RING'),
            pinky: this.isFingerExtended(landmarks, 'PINKY')
        };
        
        // 伸びている指の数をカウント
        states.extendedCount = Object.values(states).filter(v => v === true).length;
        
        return states;
    }
    
    /**
     * 親指が伸びているか判定
     * @param {Array} landmarks - ランドマーク
     * @returns {boolean}
     */
    isThumbExtended(landmarks) {
        const thumbTip = landmarks[HAND_LANDMARKS.THUMB_TIP];
        const thumbIP = landmarks[HAND_LANDMARKS.THUMB_IP];
        const thumbMCP = landmarks[HAND_LANDMARKS.THUMB_MCP];
        const indexMCP = landmarks[HAND_LANDMARKS.INDEX_MCP];
        
        // 親指の先端がMCPより外側にあるか
        const tipToIndex = distance2D(thumbTip, indexMCP);
        const mcpToIndex = distance2D(thumbMCP, indexMCP);
        
        return tipToIndex > mcpToIndex * 0.8;
    }
    
    /**
     * 指が伸びているか判定
     * @param {Array} landmarks - ランドマーク
     * @param {string} finger - 指の名前
     * @returns {boolean}
     */
    isFingerExtended(landmarks, finger) {
        const indices = {
            INDEX: { tip: 8, pip: 6, mcp: 5 },
            MIDDLE: { tip: 12, pip: 10, mcp: 9 },
            RING: { tip: 16, pip: 14, mcp: 13 },
            PINKY: { tip: 20, pip: 18, mcp: 17 }
        };
        
        const idx = indices[finger];
        if (!idx) return false;
        
        const tip = landmarks[idx.tip];
        const pip = landmarks[idx.pip];
        const mcp = landmarks[idx.mcp];
        const wrist = landmarks[HAND_LANDMARKS.WRIST];
        
        // 先端がPIPより手首から遠いか
        const tipToWrist = distance2D(tip, wrist);
        const pipToWrist = distance2D(pip, wrist);
        
        // 指が曲がっているとtipがpipより手首に近くなる
        // 10%以上遠い場合のみ「伸びている」と判定（グー判定を緩める）
        return tipToWrist > pipToWrist * 1.1;
    }
    
    /**
     * ピンチ距離を計算
     * @param {Array} landmarks - ランドマーク
     * @returns {number} 距離（正規化座標）
     */
    getPinchDistance(landmarks) {
        const thumbTip = landmarks[HAND_LANDMARKS.THUMB_TIP];
        const indexTip = landmarks[HAND_LANDMARKS.INDEX_TIP];
        return distance2D(thumbTip, indexTip);
    }
    
    /**
     * ピンチの中心点を取得
     * @param {Array} landmarks - ランドマーク
     * @returns {Object} 中心点 {x, y, z}
     */
    getPinchCenter(landmarks) {
        const thumbTip = landmarks[HAND_LANDMARKS.THUMB_TIP];
        const indexTip = landmarks[HAND_LANDMARKS.INDEX_TIP];
        
        return {
            x: (thumbTip.x + indexTip.x) / 2,
            y: (thumbTip.y + indexTip.y) / 2,
            z: (thumbTip.z + indexTip.z) / 2
        };
    }
    
    /**
     * 手のひらの中心を取得
     * @param {Array} landmarks - ランドマーク
     * @returns {Object} 中心点 {x, y, z}
     */
    getPalmCenter(landmarks) {
        // 手首と各MCPの中心
        const points = [
            landmarks[HAND_LANDMARKS.WRIST],
            landmarks[HAND_LANDMARKS.INDEX_MCP],
            landmarks[HAND_LANDMARKS.MIDDLE_MCP],
            landmarks[HAND_LANDMARKS.RING_MCP],
            landmarks[HAND_LANDMARKS.PINKY_MCP]
        ];
        
        const center = { x: 0, y: 0, z: 0 };
        points.forEach(p => {
            center.x += p.x;
            center.y += p.y;
            center.z += p.z;
        });
        
        center.x /= points.length;
        center.y /= points.length;
        center.z /= points.length;
        
        return center;
    }
    
    /**
     * ジェスチャーを分類
     * @param {Object} fingerStates - 指の状態
     * @param {number} pinchDistance - ピンチ距離
     * @param {number} handIndex - 手のインデックス
     * @returns {Object} ジェスチャー情報
     */
    classifyGesture(fingerStates, pinchDistance, handIndex) {
        const { thumb, index, middle, ring, pinky, extendedCount } = fingerStates;
        
        // グー（全ての指が曲がっている）を最優先で判定
        // extendedCount <= 1 でグーとみなす（親指だけ伸びている場合も含む）
        if (extendedCount <= 1) {
            return { type: GESTURE_TYPES.FIST, confidence: 0.9 };
        }
        
        // ピンチ判定（ヒステリシス付き）- グー判定の後
        const wasPinching = this.prevGestures.get(handIndex)?.type === GESTURE_TYPES.PINCH;
        const isPinching = wasPinching
            ? pinchDistance < this.pinchEndThreshold
            : pinchDistance < this.pinchStartThreshold;
        
        if (isPinching) {
            return { type: GESTURE_TYPES.PINCH, confidence: 0.9 };
        }
        
        // パー（全ての指が伸びている）
        if (extendedCount >= 4) {
            return { type: GESTURE_TYPES.OPEN, confidence: 0.9 };
        }
        
        // ピース（人差し指と中指だけ伸びている）
        if (index && middle && !ring && !pinky) {
            return { type: GESTURE_TYPES.PEACE, confidence: 0.85 };
        }
        
        // サムズアップ（親指だけ伸びている）
        if (thumb && !index && !middle && !ring && !pinky) {
            return { type: GESTURE_TYPES.THUMBS_UP, confidence: 0.8 };
        }
        
        // 指差し（人差し指だけ伸びている）
        if (!thumb && index && !middle && !ring && !pinky) {
            return { type: GESTURE_TYPES.POINTING, confidence: 0.8 };
        }
        
        // ロック（人差し指と小指が伸びている）
        if (index && !middle && !ring && pinky) {
            return { type: GESTURE_TYPES.ROCK, confidence: 0.8 };
        }
        
        // 判定できない場合
        return { type: GESTURE_TYPES.NONE, confidence: 0.5 };
    }
    
    /**
     * ヒステリシスを適用（チャタリング防止）
     * @param {Object} gesture - 現在のジェスチャー
     * @param {number} handIndex - 手のインデックス
     * @returns {Object} 安定化されたジェスチャー
     */
    applyHysteresis(gesture, handIndex) {
        // 履歴を取得
        if (!this.gestureHistory.has(handIndex)) {
            this.gestureHistory.set(handIndex, []);
        }
        
        const history = this.gestureHistory.get(handIndex);
        history.push(gesture.type);
        
        // 履歴サイズを制限
        if (history.length > this.historySize) {
            history.shift();
        }
        
        // 最頻値を取得
        const counts = {};
        history.forEach(type => {
            counts[type] = (counts[type] || 0) + 1;
        });
        
        let maxCount = 0;
        let stableType = gesture.type;
        
        for (const [type, count] of Object.entries(counts)) {
            if (count > maxCount) {
                maxCount = count;
                stableType = type;
            }
        }
        
        // 前回のジェスチャーを保存
        this.prevGestures.set(handIndex, gesture);
        
        // 安定したジェスチャーが過半数を占めていれば採用
        if (maxCount >= Math.ceil(this.historySize / 2)) {
            return { ...gesture, type: stableType };
        }
        
        return gesture;
    }
    
    /**
     * 2つの手の間の距離を計算
     * @param {Array} hand1Landmarks - 手1のランドマーク
     * @param {Array} hand2Landmarks - 手2のランドマーク
     * @returns {number} 距離
     */
    getHandsDistance(hand1Landmarks, hand2Landmarks) {
        if (!hand1Landmarks || !hand2Landmarks) return Infinity;
        
        const palm1 = this.getPalmCenter(hand1Landmarks);
        const palm2 = this.getPalmCenter(hand2Landmarks);
        
        return distance2D(palm1, palm2);
    }
    
    /**
     * 状態をリセット
     */
    reset() {
        this.prevGestures.clear();
        this.gestureHistory.clear();
    }
}
