/**
 * Hand Grid Controller - Gesture Recognition
 * ==========================================
 * グー・パーの判定（掴む・離す用）
 */

const HAND_LANDMARKS = {
    WRIST: 0,
    THUMB_MCP: 2,
    THUMB_IP: 3,
    THUMB_TIP: 4,
    INDEX_MCP: 5,
    INDEX_PIP: 6,
    INDEX_TIP: 8,
    MIDDLE_MCP: 9,
    MIDDLE_PIP: 10,
    RING_MCP: 13,
    RING_PIP: 14,
    PINKY_MCP: 17,
    PINKY_PIP: 18,
    PINKY_TIP: 20
};

/** 親指「伸び」判定: 旧 0.8 だとピペット把持で誤って THUMB_UP になりやすい */
const THUMB_EXTEND_VS_INDEX_MCP = 1.18;
const THUMB_EXTEND_TIP_VS_MCP_WRIST = 1.06;
const THUMB_EXTEND_TIP_VS_IP_WRIST = 1.03;

function distance3D(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = (p2.z || 0) - (p1.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export const GESTURE_TYPES = {
    NONE: 'NONE',
    OPEN: 'OPEN',   // パー
    FIST: 'FIST'    // グー（親指のみ立ちは fistSubType で区別）
};

/** グー中の細分（ピペットの吸う/出す用）。recognize の戻りに付与 */
export const FIST_SUBTYPE = {
    FULL: 'FULL',           // 完全グー（親指も曲げている）
    THUMB_UP: 'THUMB_UP'    // サムズアップ（親指のみ伸び、他指は曲げ）
};

export class GestureRecognizer {
    constructor() {
        this.prevGestures = new Map();
        this.gestureHistory = new Map();
        this.historySize = 3;
        this.fingerExtendedThreshold = 0.15;
    }

    recognize(landmarks, handIndex = 0) {
        if (!landmarks || landmarks.length < 21) {
            return { type: GESTURE_TYPES.NONE, confidence: 0, palmCenter: { x: 0.5, y: 0.5 }, fistSubType: null };
        }

        const fingerStates = this.getFingerStates(landmarks);
        let gesture = this.classifyGesture(fingerStates, handIndex);
        gesture = this.applyHysteresis(gesture, handIndex);
        gesture.palmCenter = this.getPalmCenter(landmarks);
        gesture.fistSubType = this.getFistSubType(fingerStates, gesture.type);
        return gesture;
    }

    /**
     * グー確定時のみ: 完全グー vs 親指だけ伸ばした形を返す（他指が1本でも伸びていれば FULL 扱い）
     * @param {object} fingerStates
     * @param {string} stableType
     * @returns {string | null} FIST_SUBTYPE または null
     */
    getFistSubType(fingerStates, stableType) {
        if (stableType !== GESTURE_TYPES.FIST) return null;
        const { thumb, index, middle, ring, pinky } = fingerStates;
        if (index || middle || ring || pinky) return FIST_SUBTYPE.FULL;
        if (thumb) return FIST_SUBTYPE.THUMB_UP;
        return FIST_SUBTYPE.FULL;
    }

    getFingerStates(landmarks) {
        const states = {
            thumb: this.isThumbExtended(landmarks),
            index: this.isFingerExtended(landmarks, { tip: 8, pip: 6, mcp: 5 }),
            middle: this.isFingerExtended(landmarks, { tip: 12, pip: 10, mcp: 9 }),
            ring: this.isFingerExtended(landmarks, { tip: 16, pip: 14, mcp: 13 }),
            pinky: this.isFingerExtended(landmarks, { tip: 20, pip: 18, mcp: 17 })
        };
        states.extendedCount = [states.thumb, states.index, states.middle, states.ring, states.pinky]
            .filter(v => v === true).length;
        return states;
    }

    isThumbExtended(landmarks) {
        const thumbTip = landmarks[HAND_LANDMARKS.THUMB_TIP];
        const thumbIP = landmarks[HAND_LANDMARKS.THUMB_IP];
        const thumbMCP = landmarks[HAND_LANDMARKS.THUMB_MCP];
        const indexMCP = landmarks[HAND_LANDMARKS.INDEX_MCP];
        const wrist = landmarks[HAND_LANDMARKS.WRIST];
        const tipToIndex = distance3D(thumbTip, indexMCP);
        const mcpToIndex = distance3D(thumbMCP, indexMCP);
        if (mcpToIndex < 1e-5) return false;
        const openVsIndexPlane = tipToIndex > mcpToIndex * THUMB_EXTEND_VS_INDEX_MCP;
        const tipW = distance3D(thumbTip, wrist);
        const mcpW = distance3D(thumbMCP, wrist);
        const ipW = distance3D(thumbIP, wrist);
        const outwardAlongThumb = tipW > mcpW * THUMB_EXTEND_TIP_VS_MCP_WRIST && tipW > ipW * THUMB_EXTEND_TIP_VS_IP_WRIST;
        return openVsIndexPlane && outwardAlongThumb;
    }

    isFingerExtended(landmarks, idx) {
        const tip = landmarks[idx.tip];
        const pip = landmarks[idx.pip];
        const wrist = landmarks[HAND_LANDMARKS.WRIST];
        const tipToWrist = distance3D(tip, wrist);
        const pipToWrist = distance3D(pip, wrist);
        return tipToWrist > pipToWrist * 1.1;
    }

    getPalmCenter(landmarks) {
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

    classifyGesture(fingerStates, handIndex) {
        const { extendedCount } = fingerStates;
        if (extendedCount <= 1) {
            return { type: GESTURE_TYPES.FIST, confidence: 0.9 };
        }
        if (extendedCount >= 4) {
            return { type: GESTURE_TYPES.OPEN, confidence: 0.9 };
        }
        return { type: GESTURE_TYPES.NONE, confidence: 0.5 };
    }

    applyHysteresis(gesture, handIndex) {
        if (!this.gestureHistory.has(handIndex)) {
            this.gestureHistory.set(handIndex, []);
        }
        const history = this.gestureHistory.get(handIndex);
        history.push(gesture.type);
        if (history.length > this.historySize) history.shift();

        const counts = {};
        history.forEach(type => { counts[type] = (counts[type] || 0) + 1; });
        let maxCount = 0;
        let stableType = gesture.type;
        for (const [type, count] of Object.entries(counts)) {
            if (count > maxCount) {
                maxCount = count;
                stableType = type;
            }
        }
        this.prevGestures.set(handIndex, gesture);
        if (maxCount >= Math.ceil(this.historySize / 2)) {
            return { ...gesture, type: stableType };
        }
        return gesture;
    }

    reset() {
        this.prevGestures.clear();
        this.gestureHistory.clear();
    }
}
