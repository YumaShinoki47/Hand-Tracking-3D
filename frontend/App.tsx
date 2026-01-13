import React, { useEffect, useRef, useState, useCallback } from 'react';
import { initializeHandLandmarker } from './services/visionService';
import Scene3D from './components/Scene3D';
import { Landmark, HandLandmarkerResult } from './types';
import { HandLandmarker } from '@mediapipe/tasks-vision';

const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isWebcamRunning, setIsWebcamRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Using State for rendering 3D scene (60fps updates might be better with Refs + useFrame in a more complex app, 
  // but for this scale React state is acceptable for the coordinates data flow to the Scene component)
  const [handsResult, setHandsResult] = useState<HandLandmarkerResult | null>(null);

  // Refs for loop
  const lastVideoTime = useRef(-1);
  const requestRef = useRef<number>(0);
  const prevLandmarksRef = useRef<Landmark[][] | null>(null);
  const logCounterRef = useRef(0);

  // Initialize MediaPipe
  useEffect(() => {
    const init = async () => {
      try {
        await initializeHandLandmarker();
        setLoading(false);
      } catch (err) {
        console.error(err);
        setError("Failed to load hand tracking model. Please check your connection.");
        setLoading(false);
      }
    };
    init();
  }, []);

  // Prediction Loop
  const predictWebcam = useCallback(async () => {
    const video = videoRef.current;
    // initializeHandLandmarker is cached, so safe to call repeatedly
    const handLandmarker = await initializeHandLandmarker(); 

    if (video && handLandmarker && isWebcamRunning) {
      // Skip until video is ready
      if (!video.videoWidth || !video.videoHeight) {
        requestRef.current = requestAnimationFrame(() => predictWebcam());
        return;
      }

      const startTimeMs = performance.now();
      if (video.currentTime !== lastVideoTime.current) {
        lastVideoTime.current = video.currentTime;
        const result = handLandmarker.detectForVideo(video, startTimeMs);
        
        if (result.landmarks.length > 0) {
          // Frame-to-frame smoothing (simple EMA)
          const alpha = 0.4; // weight to current frame
          const smoothedLandmarks = result.landmarks.map((hand, handIdx) =>
            hand.map((lm, idx) => {
              const prev = prevLandmarksRef.current?.[handIdx]?.[idx];
              if (!prev) return lm;
              return {
                x: prev.x * (1 - alpha) + lm.x * alpha,
                y: prev.y * (1 - alpha) + lm.y * alpha,
                z: prev.z * (1 - alpha) + lm.z * alpha,
              };
            })
          );

          prevLandmarksRef.current = smoothedLandmarks;
          setHandsResult({
            landmarks: smoothedLandmarks,
            handednesses: result.handednesses,
            worldLandmarks: result.worldLandmarks
          });

          // #region agent log
          if (logCounterRef.current++ % 20 === 0) {
            const wristNorm = smoothedLandmarks[0]?.[0];
            const wristWorld = (result.worldLandmarks as any)?.[0]?.[0];
            fetch('http://127.0.0.1:7242/ingest/5e7dfa0e-623c-476f-bd4d-f4fc7374b309',{
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body:JSON.stringify({
                sessionId:'debug-session',
                runId:'run2',
                hypothesisId:'H5',
                location:'App.tsx:predictWebcam',
                message:'World landmarks availability',
                data:{
                  videoSize:{w:video.videoWidth,h:video.videoHeight},
                  hasWorld: !!(result.worldLandmarks && result.worldLandmarks.length),
                  wristNorm: wristNorm ? {x:wristNorm.x,y:wristNorm.y,z:wristNorm.z}:null,
                  wristWorld: wristWorld ? {x:wristWorld.x,y:wristWorld.y,z:wristWorld.z}:null
                },
                timestamp: Date.now()
              })
            }).catch(()=>{});
          }
          // #endregion
        }
      }
      requestRef.current = requestAnimationFrame(() => predictWebcam());
    }
  }, [isWebcamRunning]);

  useEffect(() => {
    if (isWebcamRunning) {
      predictWebcam();
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isWebcamRunning, predictWebcam]);

  // Webcam Logic
  const startWebcam = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: 1280,
          height: 720,
          frameRate: { ideal: 30 }
        },
        audio: false
      });
      videoRef.current.srcObject = stream;
      videoRef.current.addEventListener('loadeddata', () => {
        setIsWebcamRunning(true);
        // predictWebcam loop is triggered by the useEffect when isWebcamRunning becomes true
      });
    } catch (err) {
      setError("Camera permission denied or not available.");
    }
  }, []);

  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden font-sans">
      {/* Hidden Video & Canvas for processing */}
      <div className="absolute opacity-0 pointer-events-none">
        <video ref={videoRef} autoPlay playsInline muted style={{ transform: 'scaleX(-1)' }} />
      </div>

      {/* Main 3D Scene */}
      <div className="absolute inset-0 z-0">
        <Scene3D handsResult={handsResult} />
      </div>

      {/* UI Overlay */}
      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between p-6">
        {/* Header (status only) - 左上 */}
        <div className="flex justify-start items-start pointer-events-auto">
          <div className="bg-gray-800/80 backdrop-blur-md p-4 rounded-xl border border-gray-700 shadow-xl max-w-xs">
            <h3 className="text-xs font-bold text-gray-500 uppercase mb-2 tracking-wider">Status</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-300">System</span>
                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${loading ? 'bg-yellow-500/20 text-yellow-300' : 'bg-green-500/20 text-green-300'}`}>
                  {loading ? 'INITIALIZING...' : 'READY'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-300">Camera</span>
                 <span className={`px-2 py-0.5 rounded text-xs font-semibold ${isWebcamRunning ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                  {isWebcamRunning ? 'ACTIVE' : 'INACTIVE'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                 <span className="text-gray-300">Tracking</span>
                 <span className="text-gray-400 font-mono">
                   {handsResult?.landmarks.length || 0} Hands
                 </span>
              </div>
            </div>
          </div>
        </div>

        {/* Center / Error Message */}
        {error && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
            <div className="bg-red-900/90 text-white px-6 py-4 rounded-lg shadow-2xl border border-red-500">
              <p className="font-semibold">Error</p>
              <p className="text-sm opacity-90">{error}</p>
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {loading && !error && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-auto text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-white font-medium">Loading Vision Models...</p>
          </div>
        )}

        {/* Start Button */}
        {!isWebcamRunning && !loading && !error && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
            <button
              onClick={startWebcam}
              className="group relative px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-bold shadow-[0_0_20px_rgba(37,99,235,0.5)] transition-all hover:scale-105 active:scale-95 overflow-hidden"
            >
              <span className="relative z-10">Start Camera</span>
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default App;