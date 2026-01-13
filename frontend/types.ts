export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface HandLandmarkerResult {
  landmarks: Landmark[][];
  worldLandmarks: Landmark[][];
  handednesses: { index: number; score: number; categoryName: string; displayName: string }[][];
}

