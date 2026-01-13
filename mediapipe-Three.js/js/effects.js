/**
 * Hand Magic Studio - Effects System
 * ===================================
 * パーティクル・視覚エフェクトの管理
 */

import * as THREE from 'three';
import { random, hslToHex, lerp, COLORS } from './utils.js';

/**
 * パーティクルシステム
 */
export class ParticleSystem {
    constructor(scene) {
        this.scene = scene;
        this.particles = [];
        this.trails = [];
        this.energyBalls = [];
        this.ripples = [];
        
        this.maxParticles = 3000;
        this.maxTrails = 500;
        
        // パーティクル用のジオメトリとマテリアルをプール
        this.particleGeometry = new THREE.SphereGeometry(0.02, 8, 8);
        this.trailGeometry = new THREE.SphereGeometry(0.015, 6, 6);
    }
    
    /**
     * ポイントからパーティクルを放出
     */
    emitFromPoint(position, options = {}) {
        const {
            count = 5,
            color = COLORS.primary,
            speed = 0.05,
            spread = 0.3,
            lifetime = 60,
            size = 0.02
        } = options;
        
        for (let i = 0; i < count; i++) {
            if (this.particles.length >= this.maxParticles) {
                this.removeOldestParticle();
            }
            
            const particle = this.createParticle(position, {
                color,
                speed,
                spread,
                lifetime,
                size
            });
            
            this.particles.push(particle);
            this.scene.add(particle.mesh);
        }
    }
    
    /**
     * パーティクルを作成
     */
    createParticle(position, options) {
        const { color, speed, spread, lifetime, size } = options;
        
        const geometry = new THREE.SphereGeometry(size, 8, 8);
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 1
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(position.x, position.y, position.z);
        
        // ランダムな速度ベクトル
        const velocity = new THREE.Vector3(
            random(-spread, spread) * speed,
            random(-spread, spread) * speed + speed * 0.5, // 上向きバイアス
            random(-spread, spread) * speed
        );
        
        return {
            mesh,
            velocity,
            lifetime,
            maxLifetime: lifetime,
            gravity: -0.001
        };
    }
    
    /**
     * トレイル（軌跡）を追加
     */
    addTrail(position, options = {}) {
        const {
            color = COLORS.secondary,
            size = 0.015
        } = options;
        
        if (this.trails.length >= this.maxTrails) {
            this.removeOldestTrail();
        }
        
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.8
        });
        
        const mesh = new THREE.Mesh(this.trailGeometry.clone(), material);
        mesh.position.set(position.x, position.y, position.z);
        mesh.scale.setScalar(size / 0.015);
        
        const trail = {
            mesh,
            lifetime: 30,
            maxLifetime: 30
        };
        
        this.trails.push(trail);
        this.scene.add(mesh);
    }
    
    /**
     * エネルギー球を作成
     */
    createEnergyBall(position, options = {}) {
        const {
            color = COLORS.accent,
            size = 0.1,
            pulseSpeed = 0.1
        } = options;
        
        // 外側の光る球
        const outerGeometry = new THREE.SphereGeometry(size, 32, 32);
        const outerMaterial = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.3
        });
        const outerMesh = new THREE.Mesh(outerGeometry, outerMaterial);
        
        // 内側のコア
        const innerGeometry = new THREE.SphereGeometry(size * 0.5, 16, 16);
        const innerMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.9
        });
        const innerMesh = new THREE.Mesh(innerGeometry, innerMaterial);
        
        const group = new THREE.Group();
        group.add(outerMesh);
        group.add(innerMesh);
        group.position.set(position.x, position.y, position.z);
        
        const energyBall = {
            group,
            outerMesh,
            innerMesh,
            baseSize: size,
            pulseSpeed,
            time: 0,
            lifetime: 120,
            isGrowing: true
        };
        
        this.energyBalls.push(energyBall);
        this.scene.add(group);
        
        return energyBall;
    }
    
    /**
     * エネルギー球を更新
     */
    updateEnergyBall(energyBall, position) {
        if (energyBall && energyBall.group) {
            energyBall.group.position.lerp(
                new THREE.Vector3(position.x, position.y, position.z),
                0.3
            );
        }
    }
    
    /**
     * 虹エフェクトを作成
     */
    createRainbow(startPosition, direction = { x: 0, y: 1, z: 0 }) {
        const colors = COLORS.rainbow;
        const arcPoints = 20;
        const arcHeight = 2;
        const arcLength = 3;
        
        for (let i = 0; i < arcPoints; i++) {
            const t = i / arcPoints;
            const angle = t * Math.PI;
            
            const x = startPosition.x + Math.cos(angle) * arcLength * direction.x;
            const y = startPosition.y + Math.sin(angle) * arcHeight;
            const z = startPosition.z + t * arcLength * 0.5;
            
            const colorIndex = Math.floor(t * colors.length);
            
            this.emitFromPoint(
                { x, y, z },
                {
                    count: 2,
                    color: colors[colorIndex % colors.length],
                    speed: 0.02,
                    spread: 0.1,
                    lifetime: 90,
                    size: 0.03
                }
            );
        }
    }
    
    /**
     * 波紋エフェクト
     */
    createRipple(position, options = {}) {
        const {
            color = COLORS.secondary,
            maxRadius = 2,
            speed = 0.05
        } = options;
        
        const geometry = new THREE.RingGeometry(0.1, 0.15, 32);
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(position.x, position.y, position.z);
        mesh.rotation.x = -Math.PI / 2;
        
        const ripple = {
            mesh,
            currentRadius: 0.1,
            maxRadius,
            speed,
            lifetime: 60
        };
        
        this.ripples.push(ripple);
        this.scene.add(mesh);
    }
    
    /**
     * スパークエフェクト（火花）
     */
    createSparks(position, options = {}) {
        const {
            count = 20,
            color = COLORS.warm,
            speed = 0.15
        } = options;
        
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const velocity = {
                x: Math.cos(angle) * speed * random(0.5, 1),
                y: random(0.05, 0.2),
                z: Math.sin(angle) * speed * random(0.5, 1)
            };
            
            this.emitFromPoint(position, {
                count: 1,
                color: hslToHex(random(20, 50), 100, 60),
                speed: 0.1,
                spread: 0.2,
                lifetime: 30,
                size: 0.01
            });
        }
    }
    
    /**
     * 全エフェクトを更新
     */
    update() {
        this.updateParticles();
        this.updateTrails();
        this.updateEnergyBalls();
        this.updateRipples();
    }
    
    /**
     * パーティクルを更新
     */
    updateParticles() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            
            // 位置更新
            p.mesh.position.add(p.velocity);
            
            // 重力
            p.velocity.y += p.gravity;
            
            // ライフタイム減少
            p.lifetime--;
            
            // フェードアウト
            const lifeRatio = p.lifetime / p.maxLifetime;
            p.mesh.material.opacity = lifeRatio;
            p.mesh.scale.setScalar(lifeRatio);
            
            // 寿命が尽きたら削除
            if (p.lifetime <= 0) {
                this.scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                this.particles.splice(i, 1);
            }
        }
    }
    
    /**
     * トレイルを更新
     */
    updateTrails() {
        for (let i = this.trails.length - 1; i >= 0; i--) {
            const t = this.trails[i];
            
            t.lifetime--;
            
            const lifeRatio = t.lifetime / t.maxLifetime;
            t.mesh.material.opacity = lifeRatio * 0.8;
            t.mesh.scale.setScalar(lifeRatio);
            
            if (t.lifetime <= 0) {
                this.scene.remove(t.mesh);
                t.mesh.geometry.dispose();
                t.mesh.material.dispose();
                this.trails.splice(i, 1);
            }
        }
    }
    
    /**
     * エネルギー球を更新
     */
    updateEnergyBalls() {
        for (let i = this.energyBalls.length - 1; i >= 0; i--) {
            const e = this.energyBalls[i];
            
            e.time += e.pulseSpeed;
            e.lifetime--;
            
            // パルスアニメーション
            const pulse = 1 + Math.sin(e.time) * 0.2;
            e.outerMesh.scale.setScalar(pulse);
            e.innerMesh.scale.setScalar(0.5 + Math.sin(e.time * 2) * 0.1);
            
            // 回転
            e.group.rotation.y += 0.02;
            
            // フェードアウト
            if (e.lifetime < 30) {
                const fade = e.lifetime / 30;
                e.outerMesh.material.opacity = 0.3 * fade;
                e.innerMesh.material.opacity = 0.9 * fade;
            }
            
            if (e.lifetime <= 0) {
                this.scene.remove(e.group);
                e.outerMesh.geometry.dispose();
                e.outerMesh.material.dispose();
                e.innerMesh.geometry.dispose();
                e.innerMesh.material.dispose();
                this.energyBalls.splice(i, 1);
            }
        }
    }
    
    /**
     * 波紋を更新
     */
    updateRipples() {
        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const r = this.ripples[i];
            
            r.currentRadius += r.speed;
            r.lifetime--;
            
            // スケール更新
            const scale = r.currentRadius / 0.1;
            r.mesh.scale.setScalar(scale);
            
            // フェードアウト
            const lifeRatio = r.lifetime / 60;
            r.mesh.material.opacity = lifeRatio * 0.8;
            
            if (r.lifetime <= 0 || r.currentRadius > r.maxRadius) {
                this.scene.remove(r.mesh);
                r.mesh.geometry.dispose();
                r.mesh.material.dispose();
                this.ripples.splice(i, 1);
            }
        }
    }
    
    /**
     * 最も古いパーティクルを削除
     */
    removeOldestParticle() {
        if (this.particles.length > 0) {
            const p = this.particles.shift();
            this.scene.remove(p.mesh);
            p.mesh.geometry.dispose();
            p.mesh.material.dispose();
        }
    }
    
    /**
     * 最も古いトレイルを削除
     */
    removeOldestTrail() {
        if (this.trails.length > 0) {
            const t = this.trails.shift();
            this.scene.remove(t.mesh);
            t.mesh.geometry.dispose();
            t.mesh.material.dispose();
        }
    }
    
    /**
     * 全エフェクトをクリア
     */
    clearAll() {
        // パーティクル
        this.particles.forEach(p => {
            this.scene.remove(p.mesh);
            p.mesh.geometry.dispose();
            p.mesh.material.dispose();
        });
        this.particles = [];
        
        // トレイル
        this.trails.forEach(t => {
            this.scene.remove(t.mesh);
            t.mesh.geometry.dispose();
            t.mesh.material.dispose();
        });
        this.trails = [];
        
        // エネルギー球
        this.energyBalls.forEach(e => {
            this.scene.remove(e.group);
            e.outerMesh.geometry.dispose();
            e.outerMesh.material.dispose();
            e.innerMesh.geometry.dispose();
            e.innerMesh.material.dispose();
        });
        this.energyBalls = [];
        
        // 波紋
        this.ripples.forEach(r => {
            this.scene.remove(r.mesh);
            r.mesh.geometry.dispose();
            r.mesh.material.dispose();
        });
        this.ripples = [];
    }
    
    /**
     * パーティクル数を取得
     */
    getParticleCount() {
        return this.particles.length + this.trails.length;
    }
    
    /**
     * リソースを解放
     */
    dispose() {
        this.clearAll();
        this.particleGeometry.dispose();
        this.trailGeometry.dispose();
    }
}

/**
 * 手のビジュアライザー
 */
export class HandVisualizer {
    constructor(scene) {
        this.scene = scene;
        this.hands = new Map();
        
        // 手の接続情報
        this.connections = [
            [0, 1], [1, 2], [2, 3], [3, 4],       // 親指
            [0, 5], [5, 6], [6, 7], [7, 8],       // 人差し指
            [0, 9], [9, 10], [10, 11], [11, 12],  // 中指
            [0, 13], [13, 14], [14, 15], [15, 16], // 薬指
            [0, 17], [17, 18], [18, 19], [19, 20], // 小指
            [5, 9], [9, 13], [13, 17]              // 手のひら
        ];
        
        // カラーマップ
        this.jointColors = {
            wrist: 0x8b5cf6,
            thumb: 0xf472b6,
            index: 0x22d3ee,
            middle: 0x4ade80,
            ring: 0xfbbf24,
            pinky: 0xf87171
        };
    }
    
    /**
     * 手を更新
     */
    updateHand(handIndex, landmarks, worldPosition) {
        if (!this.hands.has(handIndex)) {
            this.createHand(handIndex);
        }
        
        const hand = this.hands.get(handIndex);
        
        // 各関節の位置を更新
        landmarks.forEach((lm, idx) => {
            const joint = hand.joints[idx];
            if (joint) {
                const pos = worldPosition(lm);
                joint.position.lerp(new THREE.Vector3(pos.x, pos.y, pos.z), 0.5);
            }
        });
        
        // ボーンの位置を更新
        this.connections.forEach((conn, idx) => {
            const bone = hand.bones[idx];
            if (bone) {
                const start = hand.joints[conn[0]].position;
                const end = hand.joints[conn[1]].position;
                
                const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
                bone.position.copy(mid);
                
                const direction = new THREE.Vector3().subVectors(end, start);
                const length = direction.length();
                
                bone.scale.y = length;
                bone.quaternion.setFromUnitVectors(
                    new THREE.Vector3(0, 1, 0),
                    direction.normalize()
                );
            }
        });
        
        hand.visible = true;
    }
    
    /**
     * 手のメッシュを作成
     */
    createHand(handIndex) {
        const joints = [];
        const bones = [];
        const group = new THREE.Group();
        
        // 関節を作成
        for (let i = 0; i < 21; i++) {
            const color = this.getJointColor(i);
            const geometry = new THREE.SphereGeometry(0.015, 12, 12);
            const material = new THREE.MeshStandardMaterial({
                color: color,
                roughness: 0.3,
                metalness: 0.7,
                emissive: color,
                emissiveIntensity: 0.3
            });
            
            const joint = new THREE.Mesh(geometry, material);
            joints.push(joint);
            group.add(joint);
        }
        
        // ボーンを作成
        this.connections.forEach(() => {
            const geometry = new THREE.CylinderGeometry(0.005, 0.005, 1, 8);
            const material = new THREE.MeshStandardMaterial({
                color: 0x888888,
                transparent: true,
                opacity: 0.6
            });
            
            const bone = new THREE.Mesh(geometry, material);
            bones.push(bone);
            group.add(bone);
        });
        
        this.scene.add(group);
        
        this.hands.set(handIndex, {
            group,
            joints,
            bones,
            visible: true
        });
    }
    
    /**
     * 関節の色を取得
     */
    getJointColor(index) {
        if (index === 0) return this.jointColors.wrist;
        if (index >= 1 && index <= 4) return this.jointColors.thumb;
        if (index >= 5 && index <= 8) return this.jointColors.index;
        if (index >= 9 && index <= 12) return this.jointColors.middle;
        if (index >= 13 && index <= 16) return this.jointColors.ring;
        if (index >= 17 && index <= 20) return this.jointColors.pinky;
        return 0xffffff;
    }
    
    /**
     * 手を非表示にする
     */
    hideHand(handIndex) {
        const hand = this.hands.get(handIndex);
        if (hand) {
            hand.visible = false;
            hand.group.visible = false;
        }
    }
    
    /**
     * 全ての手を非表示
     */
    hideAllHands() {
        this.hands.forEach((hand, index) => {
            hand.group.visible = false;
        });
    }
    
    /**
     * 手の表示を更新
     */
    setHandVisibility(handIndex, visible) {
        const hand = this.hands.get(handIndex);
        if (hand) {
            hand.group.visible = visible;
        }
    }
    
    /**
     * リソースを解放
     */
    dispose() {
        this.hands.forEach(hand => {
            hand.joints.forEach(j => {
                j.geometry.dispose();
                j.material.dispose();
            });
            hand.bones.forEach(b => {
                b.geometry.dispose();
                b.material.dispose();
            });
            this.scene.remove(hand.group);
        });
        this.hands.clear();
    }
}

/**
 * マジックパーティクルフィールド
 * パー: 粒子が画面全体に散らばる
 * グー: 粒子が手の周りに球形に集まる
 */
export class MagicParticleField {
    constructor(scene) {
        this.scene = scene;
        this.particleCount = 800;
        this.particles = null;
        this.positions = null;
        this.colors = null;
        this.targetPositions = null;
        this.velocities = null;
        
        // 状態
        this.state = 'scattered'; // 'scattered' | 'gathering' | 'gathered'
        this.targetCenter = new THREE.Vector3(0, 0, 0);
        this.sphereRadius = 1.2;
        
        // アニメーション設定
        this.lerpSpeed = 0.08;
        this.scatterRange = 8;
        
        // 重力・慣性エフェクト
        this.prevCenter = new THREE.Vector3(0, 0, 0);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.gravity = 0.3;        // 重力の強さ
        this.inertia = 0.15;       // 慣性の強さ
        this.damping = 0.92;       // 減衰
        
        // 初期化
        this.init();
    }
    
    init() {
        // BufferGeometryを使用して高速なパーティクルシステムを作成
        const geometry = new THREE.BufferGeometry();
        
        this.positions = new Float32Array(this.particleCount * 3);
        this.colors = new Float32Array(this.particleCount * 3);
        this.targetPositions = new Float32Array(this.particleCount * 3);
        this.velocities = new Float32Array(this.particleCount * 3);
        this.originalScatterPositions = new Float32Array(this.particleCount * 3);
        
        // 初期位置をランダムに散らばらせる
        for (let i = 0; i < this.particleCount; i++) {
            const i3 = i * 3;
            
            // ランダムな散らばり位置
            const x = (Math.random() - 0.5) * this.scatterRange;
            const y = (Math.random() - 0.5) * this.scatterRange * 0.6;
            const z = (Math.random() - 0.5) * this.scatterRange * 0.5;
            
            this.positions[i3] = x;
            this.positions[i3 + 1] = y;
            this.positions[i3 + 2] = z;
            
            this.originalScatterPositions[i3] = x;
            this.originalScatterPositions[i3 + 1] = y;
            this.originalScatterPositions[i3 + 2] = z;
            
            this.targetPositions[i3] = x;
            this.targetPositions[i3 + 1] = y;
            this.targetPositions[i3 + 2] = z;
            
            // 微小なランダム速度
            this.velocities[i3] = (Math.random() - 0.5) * 0.002;
            this.velocities[i3 + 1] = (Math.random() - 0.5) * 0.002;
            this.velocities[i3 + 2] = (Math.random() - 0.5) * 0.002;
            
            // グラデーションカラー（青〜紫〜ピンク）
            const hue = 0.6 + Math.random() * 0.3; // 0.6-0.9 (青〜紫〜ピンク)
            const color = new THREE.Color();
            color.setHSL(hue, 0.8, 0.6);
            
            this.colors[i3] = color.r;
            this.colors[i3 + 1] = color.g;
            this.colors[i3 + 2] = color.b;
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
        
        // パーティクルマテリアル
        const material = new THREE.PointsMaterial({
            size: 0.025,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            sizeAttenuation: true,
            blending: THREE.AdditiveBlending
        });
        
        this.particles = new THREE.Points(geometry, material);
        this.scene.add(this.particles);
    }
    
    /**
     * 散らばり状態に遷移
     */
    scatter() {
        if (this.state === 'scattered') return;
        
        this.state = 'scattered';
        
        // 新しいランダム位置を生成
        for (let i = 0; i < this.particleCount; i++) {
            const i3 = i * 3;
            
            // 元の散らばり位置 + ランダムなオフセット
            this.targetPositions[i3] = this.originalScatterPositions[i3] + (Math.random() - 0.5) * 2;
            this.targetPositions[i3 + 1] = this.originalScatterPositions[i3 + 1] + (Math.random() - 0.5) * 2;
            this.targetPositions[i3 + 2] = this.originalScatterPositions[i3 + 2] + (Math.random() - 0.5) * 1;
        }
    }
    
    /**
     * 集合状態に遷移（手の位置に向かって球形に集まる）
     * @param {THREE.Vector3} center - 集合する中心位置
     */
    gather(center) {
        this.state = 'gathering';
        this.targetCenter.copy(center);
        
        // 球面上のターゲット位置を計算
        for (let i = 0; i < this.particleCount; i++) {
            const i3 = i * 3;
            
            // 黄金角を使った均等な球面分布
            const phi = Math.acos(1 - 2 * (i + 0.5) / this.particleCount);
            const theta = Math.PI * (1 + Math.sqrt(5)) * i;
            
            // 球面座標から直交座標へ
            const x = center.x + this.sphereRadius * Math.sin(phi) * Math.cos(theta);
            const y = center.y + this.sphereRadius * Math.sin(phi) * Math.sin(theta);
            const z = center.z + this.sphereRadius * Math.cos(phi);
            
            this.targetPositions[i3] = x;
            this.targetPositions[i3 + 1] = y;
            this.targetPositions[i3 + 2] = z;
        }
    }
    
    /**
     * 集合中心位置を更新（グー状態を維持しながら手を動かす場合）
     * @param {THREE.Vector3} center - 新しい中心位置
     */
    updateGatherCenter(center) {
        if (this.state !== 'gathering' && this.state !== 'gathered') return;
        
        const delta = new THREE.Vector3().subVectors(center, this.targetCenter);
        
        // 速度を更新（慣性用）
        this.velocity.add(delta.clone().multiplyScalar(this.inertia));
        
        this.targetCenter.copy(center);
        
        // すべてのターゲット位置をシフト
        for (let i = 0; i < this.particleCount; i++) {
            const i3 = i * 3;
            this.targetPositions[i3] += delta.x;
            this.targetPositions[i3 + 1] += delta.y;
            this.targetPositions[i3 + 2] += delta.z;
        }
    }
    
    /**
     * 毎フレーム更新
     */
    update() {
        if (!this.particles) return;
        
        const positionAttribute = this.particles.geometry.attributes.position;
        const colorAttribute = this.particles.geometry.attributes.color;
        
        // 速度を減衰
        this.velocity.multiplyScalar(this.damping);
        
        // 重力を速度に加算
        if (this.state === 'gathering' || this.state === 'gathered') {
            this.velocity.y -= this.gravity * 0.01;
        }
        
        let allReached = true;
        
        for (let i = 0; i < this.particleCount; i++) {
            const i3 = i * 3;
            
            // 現在位置
            let x = this.positions[i3];
            let y = this.positions[i3 + 1];
            let z = this.positions[i3 + 2];
            
            // ターゲット位置
            let tx = this.targetPositions[i3];
            let ty = this.targetPositions[i3 + 1];
            let tz = this.targetPositions[i3 + 2];
            
            // 集合状態の場合、重力・慣性エフェクトを適用
            if (this.state === 'gathering' || this.state === 'gathered') {
                // パーティクルごとに異なる遅延を持たせる（外側ほど遅れる）
                const centerDist = Math.sqrt(
                    Math.pow(tx - this.targetCenter.x, 2) +
                    Math.pow(ty - this.targetCenter.y, 2) +
                    Math.pow(tz - this.targetCenter.z, 2)
                );
                const delayFactor = 1 + (centerDist / this.sphereRadius) * 0.5;
                
                // 慣性による遅延オフセット
                const inertiaOffset = this.velocity.clone().multiplyScalar(delayFactor * 0.3);
                tx -= inertiaOffset.x;
                ty -= inertiaOffset.y;
                tz -= inertiaOffset.z;
            }
            
            // 距離を計算
            const dx = tx - x;
            const dy = ty - y;
            const dz = tz - z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            if (dist > 0.01) {
                allReached = false;
            }
            
            // Lerp（スムーズな補間）
            // 集合時は速く、散らばり時はゆっくり
            const speed = this.state === 'scattered' ? this.lerpSpeed * 0.5 : 0.12;
            x += dx * speed;
            y += dy * speed;
            z += dz * speed;
            
            // 散らばり状態の場合、微小な揺らぎを追加
            if (this.state === 'scattered') {
                x += Math.sin(Date.now() * 0.001 + i) * 0.002;
                y += Math.cos(Date.now() * 0.001 + i * 1.5) * 0.002;
                z += Math.sin(Date.now() * 0.0015 + i * 0.5) * 0.001;
            }
            
            // 位置を更新
            this.positions[i3] = x;
            this.positions[i3 + 1] = y;
            this.positions[i3 + 2] = z;
            
            // 色を状態に応じて変化
            if (this.state === 'gathering' || this.state === 'gathered') {
                // 集合中: 温かい色（オレンジ〜ゴールド）
                const hue = 0.08 + Math.random() * 0.05;
                const color = new THREE.Color();
                color.setHSL(hue, 0.9, 0.6);
                this.colors[i3] = lerp(this.colors[i3], color.r, 0.05);
                this.colors[i3 + 1] = lerp(this.colors[i3 + 1], color.g, 0.05);
                this.colors[i3 + 2] = lerp(this.colors[i3 + 2], color.b, 0.05);
            } else {
                // 散らばり中: クールな色（青〜紫）
                const hue = 0.6 + (i / this.particleCount) * 0.3;
                const color = new THREE.Color();
                color.setHSL(hue, 0.8, 0.6);
                this.colors[i3] = lerp(this.colors[i3], color.r, 0.02);
                this.colors[i3 + 1] = lerp(this.colors[i3 + 1], color.g, 0.02);
                this.colors[i3 + 2] = lerp(this.colors[i3 + 2], color.b, 0.02);
            }
        }
        
        // 状態更新
        if (this.state === 'gathering' && allReached) {
            this.state = 'gathered';
        }
        
        // BufferAttributeを更新
        positionAttribute.needsUpdate = true;
        colorAttribute.needsUpdate = true;
        
    }
    
    /**
     * 現在の状態を取得
     */
    getState() {
        return this.state;
    }
    
    /**
     * リソースを解放
     */
    dispose() {
        if (this.particles) {
            this.particles.geometry.dispose();
            this.particles.material.dispose();
            this.scene.remove(this.particles);
        }
    }
}
