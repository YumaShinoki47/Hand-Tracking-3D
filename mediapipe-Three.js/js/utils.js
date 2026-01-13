/**
 * Hand Magic Studio - Utility Functions
 * ======================================
 */

/**
 * 正規化された座標（0-1）をワールド座標に変換
 * @param {Object} landmark - {x, y, z} 正規化座標
 * @param {Object} options - 変換オプション
 * @returns {Object} ワールド座標 {x, y, z}
 */
export function normalizedToWorld(landmark, options = {}) {
    const {
        scaleX = 8,
        scaleY = 6,
        scaleZ = 4,
        offsetZ = 0
    } = options;
    
    return {
        x: (landmark.x - 0.5) * -scaleX,  // 左右反転
        y: -(landmark.y - 0.5) * scaleY,
        z: -landmark.z * scaleZ + offsetZ
    };
}

/**
 * 2点間の距離を計算
 * @param {Object} p1 - 点1 {x, y, z}
 * @param {Object} p2 - 点2 {x, y, z}
 * @returns {number} 距離
 */
export function distance3D(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = p2.z - p1.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 2点間の2D距離を計算（XY平面）
 * @param {Object} p1 - 点1 {x, y}
 * @param {Object} p2 - 点2 {x, y}
 * @returns {number} 距離
 */
export function distance2D(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 2点の中点を計算
 * @param {Object} p1 - 点1 {x, y, z}
 * @param {Object} p2 - 点2 {x, y, z}
 * @returns {Object} 中点 {x, y, z}
 */
export function midpoint(p1, p2) {
    return {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2,
        z: (p1.z + p2.z) / 2
    };
}

/**
 * 値を範囲内にクランプ
 * @param {number} value - 値
 * @param {number} min - 最小値
 * @param {number} max - 最大値
 * @returns {number} クランプされた値
 */
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * 線形補間
 * @param {number} start - 開始値
 * @param {number} end - 終了値
 * @param {number} t - 補間係数 (0-1)
 * @returns {number} 補間値
 */
export function lerp(start, end, t) {
    return start + (end - start) * t;
}

/**
 * スムース補間（イーズイン・アウト）
 * @param {number} t - 補間係数 (0-1)
 * @returns {number} スムース化された係数
 */
export function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

/**
 * ランダム値を生成
 * @param {number} min - 最小値
 * @param {number} max - 最大値
 * @returns {number} ランダム値
 */
export function random(min, max) {
    return Math.random() * (max - min) + min;
}

/**
 * ランダムな整数を生成
 * @param {number} min - 最小値
 * @param {number} max - 最大値
 * @returns {number} ランダム整数
 */
export function randomInt(min, max) {
    return Math.floor(random(min, max + 1));
}

/**
 * 配列からランダムに要素を選択
 * @param {Array} array - 配列
 * @returns {*} ランダム要素
 */
export function randomChoice(array) {
    return array[Math.floor(Math.random() * array.length)];
}

/**
 * HSL色をRGB HEXに変換
 * @param {number} h - 色相 (0-360)
 * @param {number} s - 彩度 (0-100)
 * @param {number} l - 明度 (0-100)
 * @returns {number} RGB HEX値
 */
export function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    
    let r, g, b;
    
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    
    const toHex = (v) => {
        const hex = Math.round((v + m) * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };
    
    return parseInt(toHex(r) + toHex(g) + toHex(b), 16);
}

/**
 * 角度をラジアンに変換
 * @param {number} degrees - 角度
 * @returns {number} ラジアン
 */
export function degToRad(degrees) {
    return degrees * (Math.PI / 180);
}

/**
 * ラジアンを角度に変換
 * @param {number} radians - ラジアン
 * @returns {number} 角度
 */
export function radToDeg(radians) {
    return radians * (180 / Math.PI);
}

/**
 * FPSカウンター
 */
export class FPSCounter {
    constructor() {
        this.frames = 0;
        this.lastTime = performance.now();
        this.fps = 0;
    }
    
    update() {
        this.frames++;
        const currentTime = performance.now();
        
        if (currentTime - this.lastTime >= 1000) {
            this.fps = this.frames;
            this.frames = 0;
            this.lastTime = currentTime;
        }
        
        return this.fps;
    }
}

/**
 * デバウンス関数
 * @param {Function} func - 関数
 * @param {number} wait - 待機時間（ミリ秒）
 * @returns {Function} デバウンスされた関数
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * スロットル関数
 * @param {Function} func - 関数
 * @param {number} limit - 制限時間（ミリ秒）
 * @returns {Function} スロットルされた関数
 */
export function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * 手のランドマークインデックス定数
 */
export const HAND_LANDMARKS = {
    WRIST: 0,
    THUMB_CMC: 1,
    THUMB_MCP: 2,
    THUMB_IP: 3,
    THUMB_TIP: 4,
    INDEX_MCP: 5,
    INDEX_PIP: 6,
    INDEX_DIP: 7,
    INDEX_TIP: 8,
    MIDDLE_MCP: 9,
    MIDDLE_PIP: 10,
    MIDDLE_DIP: 11,
    MIDDLE_TIP: 12,
    RING_MCP: 13,
    RING_PIP: 14,
    RING_DIP: 15,
    RING_TIP: 16,
    PINKY_MCP: 17,
    PINKY_PIP: 18,
    PINKY_DIP: 19,
    PINKY_TIP: 20
};

/**
 * カラーパレット
 */
export const COLORS = {
    primary: 0x8b5cf6,
    secondary: 0x06b6d4,
    accent: 0xf472b6,
    warm: 0xfb923c,
    cool: 0x22d3ee,
    white: 0xffffff,
    rainbow: [0xff6b6b, 0xffa500, 0xffff00, 0x00ff00, 0x00bfff, 0x4b0082, 0x9400d3]
};
