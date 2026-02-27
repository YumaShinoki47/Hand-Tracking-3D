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

function distance2D(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

export const GESTURE_TYPES = {
    NONE: 'NONE',
    OPEN: 'OPEN',   // パー
    FIST: 'FIST'    // グー
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
            return { type: GESTURE_TYPES.NONE, confidence: 0, palmCenter: { x: 0.5, y: 0.5 } };
        }

        const fingerStates = this.getFingerStates(landmarks);
        let gesture = this.classifyGesture(fingerStates, handIndex);
        gesture = this.applyHysteresis(gesture, handIndex);
        gesture.palmCenter = this.getPalmCenter(landmarks);
        return gesture;
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
        const thumbMCP = landmarks[HAND_LANDMARKS.THUMB_MCP];
        const indexMCP = landmarks[HAND_LANDMARKS.INDEX_MCP];
        const tipToIndex = distance2D(thumbTip, indexMCP);
        const mcpToIndex = distance2D(thumbMCP, indexMCP);
        return tipToIndex > mcpToIndex * 0.8;
    }

    isFingerExtended(landmarks, idx) {
        const tip = landmarks[idx.tip];
        const pip = landmarks[idx.pip];
        const wrist = landmarks[HAND_LANDMARKS.WRIST];
        const tipToWrist = distance2D(tip, wrist);
        const pipToWrist = distance2D(pip, wrist);
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
