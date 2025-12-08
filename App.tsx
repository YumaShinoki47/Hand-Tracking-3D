import React, { useEffect, useRef, useState, useCallback } from 'react';
import { initializeHandLandmarker } from './services/visionService';
import { analyzeHandGesture } from './services/geminiService';
import Scene3D from './components/Scene3D';
import { Landmark, GestureStatus, AnalysisResult } from './types';
import { HandLandmarker } from '@mediapipe/tasks-vision';

const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null); // For capturing snapshots
  const [isWebcamRunning, setIsWebcamRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Using State for rendering 3D scene (60fps updates might be better with Refs + useFrame in a more complex app, 
  // but for this scale React state is acceptable for the coordinates data flow to the Scene component)
  const [handsResult, setHandsResult] = useState<{ landmarks: Landmark[][], handednesses: any[][] } | null>(null);

  // Gesture Analysis State
  const [analysisStatus, setAnalysisStatus] = useState<GestureStatus>(GestureStatus.IDLE);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  // Refs for loop
  const lastVideoTime = useRef(-1);
  const requestRef = useRef<number>(0);

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
      const startTimeMs = performance.now();
      if (video.currentTime !== lastVideoTime.current) {
        lastVideoTime.current = video.currentTime;
        const result = handLandmarker.detectForVideo(video, startTimeMs);
        
        if (result.landmarks.length > 0) {
          setHandsResult({
            landmarks: result.landmarks,
            handednesses: result.handednesses
          });
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

  // Snapshot and Gemini Analysis
  const handleAnalyze = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    setAnalysisStatus(GestureStatus.ANALYZING);
    setAnalysisResult(null);

    try {
      // Draw video frame to canvas
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageBase64 = canvas.toDataURL('image/jpeg', 0.8);
        
        // Call Gemini
        const result = await analyzeHandGesture(imageBase64);
        setAnalysisResult(result);
        setAnalysisStatus(GestureStatus.SUCCESS);
      }
    } catch (e) {
      console.error(e);
      setAnalysisStatus(GestureStatus.ERROR);
    }
  };

  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden font-sans">
      {/* Hidden Video & Canvas for processing */}
      <div className="absolute opacity-0 pointer-events-none">
        <video ref={videoRef} autoPlay playsInline muted style={{ transform: 'scaleX(-1)' }} />
        <canvas ref={canvasRef} />
      </div>

      {/* Main 3D Scene */}
      <div className="absolute inset-0 z-0">
        <Scene3D handsResult={handsResult} />
      </div>

      {/* UI Overlay */}
      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between p-6">
        {/* Header */}
        <div className="flex justify-between items-start pointer-events-auto">
          <div>
            <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
              HandTracking 3D Pro
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Powered by MediaPipe & Gemini
            </p>
          </div>
          
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

        {/* Bottom Panel - Analysis */}
        <div className="flex justify-center items-end pointer-events-auto space-x-4">
          {/* Analysis Result Card */}
          {analysisStatus === GestureStatus.SUCCESS && analysisResult && (
            <div className="mb-8 bg-gray-900/90 backdrop-blur-xl border border-blue-500/30 p-6 rounded-2xl max-w-md w-full shadow-2xl animate-in fade-in slide-in-from-bottom-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold text-white">{analysisResult.gesture}</h2>
                <span className="px-2 py-1 bg-blue-500/20 text-blue-300 text-xs rounded-full border border-blue-500/20">
                  {analysisResult.confidence} Confidence
                </span>
              </div>
              <p className="text-gray-300 text-sm leading-relaxed">
                {analysisResult.description}
              </p>
              <button 
                onClick={() => setAnalysisStatus(GestureStatus.IDLE)}
                className="mt-4 text-xs text-gray-500 hover:text-white underline w-full text-center"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Analyze Button */}
          {isWebcamRunning && analysisStatus !== GestureStatus.SUCCESS && (
            <div className="mb-8">
              <button
                onClick={handleAnalyze}
                disabled={analysisStatus === GestureStatus.ANALYZING}
                className={`
                  flex items-center space-x-3 px-6 py-3 rounded-xl border border-white/10 shadow-lg backdrop-blur-md transition-all
                  ${analysisStatus === GestureStatus.ANALYZING 
                    ? 'bg-gray-700/50 cursor-wait' 
                    : 'bg-white/10 hover:bg-white/20 active:scale-95 hover:border-blue-400/50'}
                `}
              >
                {analysisStatus === GestureStatus.ANALYZING ? (
                   <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span className="text-blue-300 font-medium">Asking Gemini...</span>
                   </>
                ) : (
                  <>
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                      </svg>
                    </div>
                    <div className="text-left">
                      <div className="text-sm font-semibold text-white">Analyze Gesture</div>
                      <div className="text-xs text-gray-400">Gemini 2.5 Flash</div>
                    </div>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;