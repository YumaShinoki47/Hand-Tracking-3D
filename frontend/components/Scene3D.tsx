import React, { useMemo, useRef, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { Landmark } from '../types';
import { HAND_CONNECTIONS, JOINT_COLORS } from '../constants';

interface DebugData {
  verticalSize: number;
  horizontalSize: number;
  horizontalSizeNormalized: number;
  palmSize: number;
  rawEstimatedDistance: number;
  estimatedDistance: number;
}

interface HandProps {
  landmarks: Landmark[];
  handedness: string;
  onHandUpdate?: (data: { position: THREE.Vector3, isPinching: boolean }) => void;
  onDebugUpdate?: (data: DebugData) => void;
}

const JointSphere: React.FC<{ position: THREE.Vector3, index: number }> = ({ position, index }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  // Lerp to position for smoothness
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.position.lerp(position, 0.35); // stronger smoothing
    }
  });

  let color = JOINT_COLORS.DEFAULT;
  if (index === 0) color = JOINT_COLORS.WRIST;
  else if (index >= 1 && index <= 4) color = JOINT_COLORS.THUMB;
  else if (index >= 5 && index <= 8) color = JOINT_COLORS.INDEX;
  else if (index >= 9 && index <= 12) color = JOINT_COLORS.MIDDLE;
  else if (index >= 13 && index <= 16) color = JOINT_COLORS.RING;
  else if (index >= 17 && index <= 20) color = JOINT_COLORS.PINKY;

  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[0.015, 16, 16]} />
      <meshStandardMaterial color={color} roughness={0.3} metalness={0.8} />
    </mesh>
  );
};

const BoneCylinder: React.FC<{ start: THREE.Vector3, end: THREE.Vector3 }> = ({ start, end }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame(() => {
    if (meshRef.current) {
      const currentPos = meshRef.current.position.clone();
      const targetPos = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
      
      const direction = new THREE.Vector3().subVectors(end, start);
      const length = direction.length();

      // Avoid rendering invalid bones
      if (length < 0.0001) {
        meshRef.current.visible = false;
        return;
      }
      meshRef.current.visible = true;

      const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize()
      );
      
      meshRef.current.position.lerp(targetPos, 0.35); // stronger smoothing
      meshRef.current.quaternion.slerp(targetQuaternion, 0.35);
      meshRef.current.scale.set(1, length, 1); // Scale height to length (initial geom height is 1)
    }
  });

  // Initial calculation for safe render before first frame
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const position = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize()
  );

  return (
    <mesh ref={meshRef} position={position} quaternion={quaternion}>
      {/* Height 1 for easier scaling */}
      <cylinderGeometry args={[0.005, 0.005, 1, 8]} />
      <meshStandardMaterial color="#888888" transparent opacity={0.6} />
    </mesh>
  );
};

// Component to visualize the interaction point (pinch center)
const PinchCursor: React.FC<{ position: THREE.Vector3, isPinching: boolean }> = ({ position, isPinching }) => {
  return (
    <mesh position={position}>
      <sphereGeometry args={[isPinching ? 0.015 : 0.01, 16, 16]} />
      <meshBasicMaterial color={isPinching ? "#ffff00" : "#ffffff"} opacity={0.8} transparent />
    </mesh>
  );
};

const clampZ = (z: number, min = -3.0, max = 2.5) => Math.min(max, Math.max(min, z));

const HandMesh: React.FC<HandProps> = ({ landmarks, onHandUpdate, onDebugUpdate }) => {
  const { camera } = useThree();
  
  // ヒステリシス用: 前回のピンチ状態を保持
  const isPinchingRef = useRef(false);
  const [isPinchingState, setIsPinchingState] = useState(false);

  // Convert landmarks to Vector3 with depth estimation
  const { vectors, pinchCenter, pinchDistance, debugData } = useMemo(() => {
    // 1. 深度推定 (Depth Estimation)
    // 縦方向: 手首 → 中指の付け根
    const wrist = landmarks[0];
    const middleMCP = landmarks[9];
    const dx1 = wrist.x - middleMCP.x;
    const dy1 = wrist.y - middleMCP.y;
    const verticalSize = Math.sqrt(dx1 * dx1 + dy1 * dy1);

    // 横方向: 人差し指の付け根 → 小指の付け根
    const indexMCP = landmarks[5];
    const pinkyMCP = landmarks[17];
    const dx2 = indexMCP.x - pinkyMCP.x;
    const dy2 = indexMCP.y - pinkyMCP.y;
    const horizontalSize = Math.sqrt(dx2 * dx2 + dy2 * dy2);

    // 横方向を補正（解剖学的に縦:横の比率に合わせてスケール調整）
    const HORIZONTAL_SCALE = 1.8;
    const horizontalSizeNormalized = horizontalSize * HORIZONTAL_SCALE;

    // 大きい方を採用（手の傾きに対して堅牢）
    const palmSize = Math.max(verticalSize, horizontalSizeNormalized);

    const REFERENCE_SIZE = 0.15; 
    const REFERENCE_DEPTH = 1.5; 
    
    // カメラからの距離推定 (Estimated distance from camera based on palm size)
    const rawEstimatedDistance = (REFERENCE_SIZE / Math.max(palmSize, 0.01)) * REFERENCE_DEPTH;
    
    // 推定距離をクランプ（極端な値を防ぐ）
    // 近すぎ: 0.5以下 → 手がカメラに近すぎる
    // 遠すぎ: 4.0以上 → 手がカメラから遠すぎて精度低下
    const MIN_DISTANCE = 0.5;
    const MAX_DISTANCE = 4.0;
    const estimatedDistance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, rawEstimatedDistance));
    
    // Z軸の反転 (Inverted Z-axis)
    // 以前: const worldZ = 1.5 - estimatedDistance; (Hand Close -> Virtual Close)
    // 現在: Hand Close (Small Distance) -> Virtual Deep (Negative Z)
    // "Reach In" effect.
    const worldZ = estimatedDistance - 1.5;

    // 2. 透視投影の逆変換 (Unproject)
    const pCamera = camera as THREE.PerspectiveCamera;
    const fovRad = (pCamera.fov * Math.PI) / 180;
    // Note: We use estimatedDistance for XY scaling to match the video feed overlay size
    // even though the Z position is inverted for interaction logic.
    const visibleHeightAtZ = 2 * Math.tan(fovRad / 2) * estimatedDistance;
    const visibleWidthAtZ = visibleHeightAtZ * pCamera.aspect;

    // Depth: use a single scale based on height to keep aspect-consistent
    const depthScale = visibleHeightAtZ * 0.5; // tune: higher => deeper reach effect

    const vectors = landmarks.map(l => {
      const x = (l.x - 0.5) * -visibleWidthAtZ; 
      const y = -(l.y - 0.5) * visibleHeightAtZ;
      const zLocal = -l.z * depthScale; 
      const z = clampZ(worldZ + zLocal); // clamp to avoid extreme depth jumps
      return new THREE.Vector3(x, y, z);
    });

    // 3. Pinch (つまむ) ジェスチャーの検出
    // 親指の先 (4) と人差指の先 (8)
    const thumbTip = vectors[4];
    const indexTip = vectors[8];
    const pinchDistance = thumbTip.distanceTo(indexTip);
    
    // 中間地点（カーソル位置）
    const center = new THREE.Vector3().addVectors(thumbTip, indexTip).multiplyScalar(0.5);

    // デバッグデータ
    const debugData: DebugData = { verticalSize, horizontalSize, horizontalSizeNormalized, palmSize, rawEstimatedDistance, estimatedDistance };

    return { vectors, pinchCenter: center, pinchDistance, debugData };
  }, [landmarks, camera]);

  // ヒステリシス付きピンチ判定
  // 開始閾値: より厳しく（確実にピンチしたときだけON）
  // 終了閾値: より緩く（確実に離したときだけOFF）
  const PINCH_START_THRESHOLD = 0.06;  // この距離以下でピンチ開始
  const PINCH_END_THRESHOLD = 0.12;    // この距離以上でピンチ終了

  // Notify parent of hand status (using ref mechanism ideally, but effect is ok for this scale)
  useFrame(() => {
    // ヒステリシス付きピンチ判定
    let newPinching = isPinchingRef.current;
    if (isPinchingRef.current) {
      // 現在ピンチ中 → 終了閾値を超えたら解除
      if (pinchDistance > PINCH_END_THRESHOLD) {
        newPinching = false;
      }
    } else {
      // 現在ピンチしていない → 開始閾値を下回ったらピンチ開始
      if (pinchDistance < PINCH_START_THRESHOLD) {
        newPinching = true;
      }
    }
    
    // 状態が変わった場合のみ更新
    if (newPinching !== isPinchingRef.current) {
      isPinchingRef.current = newPinching;
      setIsPinchingState(newPinching);
    }

    if (onHandUpdate) {
      onHandUpdate({ position: pinchCenter, isPinching: isPinchingRef.current });
    }
    if (onDebugUpdate) {
      onDebugUpdate(debugData);
    }
  });

  return (
    <group>
      {vectors.map((v, i) => (
        <JointSphere key={`joint-${i}`} position={v} index={i} />
      ))}
      {HAND_CONNECTIONS.map(([startIdx, endIdx], i) => (
        <BoneCylinder 
          key={`bone-${i}`} 
          start={vectors[startIdx]} 
          end={vectors[endIdx]} 
        />
      ))}
      {/* Show cursor helper */}
      <PinchCursor position={pinchCenter} isPinching={isPinchingState} />
    </group>
  );
};

// --- Cube Logic ---

const InteractiveCube = ({ handDataRef }: { handDataRef: React.MutableRefObject<{ position: THREE.Vector3, isPinching: boolean } | null> }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  // Internal state for logic (using Refs for performance in useFrame)
  const isGrabbingRef = useRef(false);
  const grabOffsetRef = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!meshRef.current || !handDataRef.current) return;

    const { position: handPos, isPinching } = handDataRef.current;
    const cubePos = meshRef.current.position;

    // Interaction distance threshold (e.g., 15cm)
    const distanceToCube = handPos.distanceTo(cubePos);
    const INTERACTION_RADIUS = 0.15;

    if (isGrabbingRef.current) {
      // 現在掴んでいる場合
      if (isPinching) {
        // まだ掴んでいる -> 位置を更新
        // オフセットを加味して移動
        const targetPos = new THREE.Vector3().addVectors(handPos, grabOffsetRef.current);
        meshRef.current.position.lerp(targetPos, 0.2); // Smooth follow
        (meshRef.current.material as THREE.MeshStandardMaterial).color.set('#ff3333'); // Red when grabbed
      } else {
        // 放した
        isGrabbingRef.current = false;
        (meshRef.current.material as THREE.MeshStandardMaterial).color.set('#00ffff'); // Back to Cyan
      }
    } else {
      // まだ掴んでいない場合
      if (isPinching && distanceToCube < INTERACTION_RADIUS) {
        // 近くでPinchした -> 掴み開始
        isGrabbingRef.current = true;
        // 現在位置と手の位置の差分（オフセット）を記録
        grabOffsetRef.current.subVectors(cubePos, handPos);
      } else {
        // ホバー状態の視覚フィードバック
        if (distanceToCube < INTERACTION_RADIUS) {
           (meshRef.current.material as THREE.MeshStandardMaterial).color.set('#ffaa00'); // Orange when hover
        } else {
           (meshRef.current.material as THREE.MeshStandardMaterial).color.set('#00ffff'); // Default Cyan
        }
      }
    }
  });

  return (
    <mesh ref={meshRef} position={[0, 0, 0]} castShadow receiveShadow>
      <boxGeometry args={[0.15, 0.15, 0.15]} />
      <meshStandardMaterial color="#00ffff" roughness={0.2} metalness={0.5} />
    </mesh>
  );
};

interface Scene3DProps {
  handsResult: { landmarks: Landmark[][], handednesses: any[][] } | null;
}

const Scene3D: React.FC<Scene3DProps> = ({ handsResult }) => {
  // Shared data ref to bridge HandMesh (Logic) and Cube (Object)
  const handDataRef = useRef<{ position: THREE.Vector3, isPinching: boolean } | null>(null);
  const [debugData, setDebugData] = useState<DebugData | null>(null);
  const [handPositions, setHandPositions] = useState<Array<{ x: number, y: number, z: number, handIndex: number, isPinching: boolean, handedness: string }>>([]);

  const handleHandUpdate = (data: { position: THREE.Vector3, isPinching: boolean }, handIndex: number, handedness: string) => {
    if (handIndex === 0) handDataRef.current = data;
    setHandPositions(prev => {
      const newPositions = prev.filter(p => p.handIndex !== handIndex);
      newPositions.push({ x: data.position.x, y: data.position.y, z: data.position.z, handIndex, isPinching: data.isPinching, handedness });
      return newPositions;
    });
  };

  // 手が検出されなくなったらクリア
  React.useEffect(() => {
    const numHands = handsResult?.landmarks.length || 0;
    setHandPositions(prev => prev.filter(p => p.handIndex < numHands));
    if (numHands === 0) {
      handDataRef.current = null;
    }
  }, [handsResult?.landmarks.length]);

  const handleDebugUpdate = (data: DebugData) => {
    setDebugData(data);
  };

  // ミニマップ用: 座標を画面位置に変換 (X-Z平面, 真上から見た視点)
  const mapSize = 200; // ピクセル（大きめに）
  const mapRange = 2.0; // 空間の範囲 (-2 to +2)
  const toMapX = (x: number) => ((x + mapRange) / (mapRange * 2)) * mapSize;
  // カメラ視点に合わせる: +Z=手前=画面下、-Z=奥=画面上
  const toMapY = (z: number) => ((z + mapRange) / (mapRange * 2)) * mapSize;

  return (
    <div className="relative w-full h-full">
      {/* Pinch Indicator - 画面下部（左手は左、右手は右に固定表示） */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50 flex gap-8">
        {/* 左手スロット（画面左側） */}
        {(() => {
          const leftHand = handPositions.find(h => h.handedness === 'Right'); // MediaPipe Right = 実際の左手
          const isDetected = !!leftHand;
          const isPinching = leftHand?.isPinching || false;
          
          return (
            <div 
              className={`
                px-6 py-3 rounded-full border-2 transition-all duration-150 min-w-[140px]
                ${!isDetected 
                  ? 'bg-gray-900/60 border-gray-700 opacity-50' 
                  : isPinching 
                    ? 'bg-yellow-500/90 border-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.6)] scale-110' 
                    : 'bg-gray-800/80 border-gray-600 backdrop-blur-sm'
                }
              `}
            >
              <div className="flex items-center gap-3">
                <span className={`text-2xl transition-transform duration-150 ${isPinching ? 'scale-125' : ''}`}>
                  {!isDetected ? '✋' : isPinching ? '✊' : '✋'}
                </span>
                <div className="text-left">
                  <div className={`text-xs font-bold ${isPinching ? 'text-yellow-900' : 'text-gray-400'}`}>
                    左手
                  </div>
                  <div className={`text-sm font-bold ${!isDetected ? 'text-gray-600' : isPinching ? 'text-yellow-900' : 'text-white'}`}>
                    {!isDetected ? '---' : isPinching ? 'GRABBING' : 'OPEN'}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 右手スロット（画面右側） */}
        {(() => {
          const rightHand = handPositions.find(h => h.handedness === 'Left'); // MediaPipe Left = 実際の右手
          const isDetected = !!rightHand;
          const isPinching = rightHand?.isPinching || false;
          
          return (
            <div 
              className={`
                px-6 py-3 rounded-full border-2 transition-all duration-150 min-w-[140px]
                ${!isDetected 
                  ? 'bg-gray-900/60 border-gray-700 opacity-50' 
                  : isPinching 
                    ? 'bg-yellow-500/90 border-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.6)] scale-110' 
                    : 'bg-gray-800/80 border-gray-600 backdrop-blur-sm'
                }
              `}
            >
              <div className="flex items-center gap-3">
                <span className={`text-2xl transition-transform duration-150 ${isPinching ? 'scale-125' : ''}`}>
                  {!isDetected ? '✋' : isPinching ? '✊' : '✋'}
                </span>
                <div className="text-left">
                  <div className={`text-xs font-bold ${isPinching ? 'text-yellow-900' : 'text-gray-400'}`}>
                    右手
                  </div>
                  <div className={`text-sm font-bold ${!isDetected ? 'text-gray-600' : isPinching ? 'text-yellow-900' : 'text-white'}`}>
                    {!isDetected ? '---' : isPinching ? 'GRABBING' : 'OPEN'}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Minimap - 右上 (真上からの視点: X-Z平面) */}
      <div className="absolute top-4 right-4 z-50 bg-black/80 backdrop-blur-sm p-2 rounded-lg border border-gray-600">
        <div className="text-gray-400 text-[10px] font-bold mb-1 text-center">🗺️ Top View (X-Z)</div>
        <div 
          className="relative bg-slate-800 rounded border border-slate-600"
          style={{ width: mapSize, height: mapSize }}
        >
          {/* グリッド線 */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="absolute w-full h-px bg-gray-700" />
            <div className="absolute h-full w-px bg-gray-700" />
          </div>
          
          {/* 原点マーカー */}
          <div 
            className="absolute w-2 h-2 bg-gray-600 rounded-full -translate-x-1/2 -translate-y-1/2"
            style={{ left: mapSize / 2, top: mapSize / 2 }}
          />
          
          {/* カメラ位置インジケータ（下部） */}
          <div 
            className="absolute text-[8px] text-gray-500"
            style={{ left: mapSize / 2, top: mapSize + 2, transform: 'translateX(-50%)' }}
          >
            📷
          </div>
          
          {/* 手の位置（複数対応） */}
          {handPositions.map((pos, idx) => (
            <div 
              key={pos.handIndex}
              className={`absolute w-4 h-4 rounded-full -translate-x-1/2 -translate-y-1/2 ${
                pos.handIndex === 0 
                  ? 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]' 
                  : 'bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.8)]'
              }`}
              style={{ 
                left: Math.min(Math.max(toMapX(pos.x), 0), mapSize),
                top: Math.min(Math.max(toMapY(pos.z), 0), mapSize)
              }}
            />
          ))}
        </div>
        {/* 座標表示 */}
        {handPositions.length > 0 && (
          <div className="mt-2 text-[10px] font-mono text-gray-400 space-y-1">
            {handPositions.map((pos) => (
              <div key={pos.handIndex} className="flex items-center gap-2">
                <span className={pos.handIndex === 0 ? 'text-cyan-400' : 'text-orange-400'}>
                  {pos.handedness === 'Left' ? '右' : pos.handedness === 'Right' ? '左' : `手${pos.handIndex + 1}`}:
                </span>
                <span>X:{pos.x.toFixed(2)} Z:{pos.z.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Debug Monitor - 右下 */}
      <div className="absolute bottom-4 right-4 z-50 bg-black/80 backdrop-blur-sm p-3 rounded-lg border border-gray-600 font-mono text-xs">
        <div className="text-gray-400 mb-2 font-bold">📊 Palm Size Monitor</div>
        {debugData ? (
          <div className="space-y-1">
            <div className="flex justify-between gap-4">
              <span className="text-cyan-400">縦 (手首→中指):</span>
              <span className="text-white">{debugData.verticalSize.toFixed(4)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-orange-400">横 (人差→小指):</span>
              <span className="text-white">{debugData.horizontalSize.toFixed(4)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-pink-400">横 (補正後×1.8):</span>
              <span className="text-white">{debugData.horizontalSizeNormalized.toFixed(4)}</span>
            </div>
            <div className="border-t border-gray-600 my-1"></div>
            <div className="flex justify-between gap-4">
              <span className="text-green-400">採用値 (max):</span>
              <span className="text-white font-bold">{debugData.palmSize.toFixed(4)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-yellow-400">推定距離 (生):</span>
              <span className="text-white">{debugData.rawEstimatedDistance.toFixed(2)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-lime-400">推定距離 (制限):</span>
              <span className={`font-bold ${debugData.rawEstimatedDistance !== debugData.estimatedDistance ? 'text-red-400' : 'text-white'}`}>
                {debugData.estimatedDistance.toFixed(2)}
                {debugData.rawEstimatedDistance !== debugData.estimatedDistance && ' ⚠'}
              </span>
            </div>
            {/* バー表示 - 補正後の値で比較 */}
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-cyan-400 w-8">縦</span>
                <div className="flex-1 bg-gray-700 h-2 rounded">
                  <div 
                    className="bg-cyan-400 h-2 rounded" 
                    style={{ width: `${Math.min(debugData.verticalSize * 300, 100)}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-pink-400 w-8">横*</span>
                <div className="flex-1 bg-gray-700 h-2 rounded">
                  <div 
                    className="bg-pink-400 h-2 rounded" 
                    style={{ width: `${Math.min(debugData.horizontalSizeNormalized * 300, 100)}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="text-gray-500 text-[10px] mt-1">* 横は×1.8補正済み</div>
          </div>
        ) : (
          <div className="text-gray-500">手を検出してください...</div>
        )}
      </div>

      <Canvas camera={{ position: [0, 0, 1.5], fov: 50 }} shadows>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} castShadow />
      <Environment preset="city" />
      
      {/* Visual Guides */}
      <Grid 
        position={[0, -1, 0]} 
        args={[10, 10]} 
        cellColor="#6f6f6f" 
        sectionColor="#9d4b4b" 
        fadeDistance={20}
        sectionThickness={1}
        cellThickness={0.5}
      />
      
      <OrbitControls makeDefault />

      {/* The Cube Object */}
      <InteractiveCube handDataRef={handDataRef} />

      {handsResult && handsResult.landmarks.map((landmarks, index) => {
        const handedness = handsResult.handednesses[index]?.[0]?.categoryName || 'Unknown';
        const onDebug = index === 0 ? handleDebugUpdate : undefined;
        
        return (
          <HandMesh 
            key={index} 
            landmarks={landmarks} 
            handedness={handedness} 
            onHandUpdate={(data) => handleHandUpdate(data, index, handedness)}
            onDebugUpdate={onDebug}
          />
        );
      })}
      
      {/* Floor for reference with shadow */}
      <mesh position={[0, -1, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
         <planeGeometry args={[20, 20]} />
         <meshStandardMaterial color="#111" transparent opacity={0.5} roughness={0.8} />
      </mesh>
    </Canvas>
    </div>
  );
};

export default Scene3D;