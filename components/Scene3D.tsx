import React, { useMemo, useRef, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { Landmark } from '../types';
import { HAND_CONNECTIONS, JOINT_COLORS } from '../constants';

interface HandProps {
  landmarks: Landmark[];
  handedness: string;
  onHandUpdate?: (data: { position: THREE.Vector3, isPinching: boolean }) => void;
}

const JointSphere: React.FC<{ position: THREE.Vector3, index: number }> = ({ position, index }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  // Lerp to position for smoothness
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.position.lerp(position, 0.2);
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
      
      meshRef.current.position.lerp(targetPos, 0.2);
      meshRef.current.quaternion.slerp(targetQuaternion, 0.2);
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

const HandMesh: React.FC<HandProps> = ({ landmarks, onHandUpdate }) => {
  const { camera } = useThree();

  // Convert landmarks to Vector3 with depth estimation
  const { vectors, pinchData } = useMemo(() => {
    // 1. 深度推定 (Depth Estimation)
    const wrist = landmarks[0];
    const middleMCP = landmarks[9];
    const dx = wrist.x - middleMCP.x;
    const dy = wrist.y - middleMCP.y;
    const palmSize = Math.sqrt(dx * dx + dy * dy);

    const REFERENCE_SIZE = 0.15; 
    const REFERENCE_DEPTH = 1.5; 
    
    // カメラからの距離推定 (Estimated distance from camera based on palm size)
    const estimatedDistance = (REFERENCE_SIZE / Math.max(palmSize, 0.01)) * REFERENCE_DEPTH;
    
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

    const vectors = landmarks.map(l => {
      const x = (l.x - 0.5) * -visibleWidthAtZ; 
      const y = -(l.y - 0.5) * visibleHeightAtZ;
      const zLocal = -l.z * visibleWidthAtZ; 
      return new THREE.Vector3(x, y, worldZ + zLocal);
    });

    // 3. Pinch (つまむ) ジェスチャーの検出
    // 親指の先 (4) と人差指の先 (8)
    const thumbTip = vectors[4];
    const indexTip = vectors[8];
    const distance = thumbTip.distanceTo(indexTip);
    
    // 中間地点（カーソル位置）
    const center = new THREE.Vector3().addVectors(thumbTip, indexTip).multiplyScalar(0.5);
    
    // 閾値: 3D空間上で約3cm以下ならPinchとみなす
    const isPinching = distance < 0.08; 

    return { vectors, pinchData: { center, isPinching } };
  }, [landmarks, camera]);

  // Notify parent of hand status (using ref mechanism ideally, but effect is ok for this scale)
  useFrame(() => {
    if (onHandUpdate) {
      onHandUpdate({ position: pinchData.center, isPinching: pinchData.isPinching });
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
      <PinchCursor position={pinchData.center} isPinching={pinchData.isPinching} />
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

  const handleHandUpdate = (data: { position: THREE.Vector3, isPinching: boolean }) => {
    handDataRef.current = data;
  };

  return (
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
        // Only allow the first hand to interact for simplicity
        const onUpdate = index === 0 ? handleHandUpdate : undefined;
        
        return (
          <HandMesh 
            key={index} 
            landmarks={landmarks} 
            handedness={handedness} 
            onHandUpdate={onUpdate}
          />
        );
      })}
      
      {/* Floor for reference with shadow */}
      <mesh position={[0, -1, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
         <planeGeometry args={[20, 20]} />
         <meshStandardMaterial color="#111" transparent opacity={0.5} roughness={0.8} />
      </mesh>
    </Canvas>
  );
};

export default Scene3D;