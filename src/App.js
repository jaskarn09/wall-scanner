import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, Square, Plus, Layers, Paintbrush, RotateCcw, Box, Download, Share2, AlertCircle, Brain, Menu, X } from 'lucide-react';
import { detectWithYOLO, loadYOLOModel } from './yoloDetector';

const WallScanner3D = () => {
  const [isScanning, setIsScanning] = useState(false);
  const [walls, setWalls] = useState([]);
  const [viewMode, setViewMode] = useState('scan');
  const [selectedTexture, setSelectedTexture] = useState('paint-white');
  const [detectedElements, setDetectedElements] = useState([]);
  const [scanProgress, setScanProgress] = useState(0);
  const [rotation, setRotation] = useState({ x: 20, y: 45 });
  const [autoRotate, setAutoRotate] = useState(true);
  const [roomModel, setRoomModel] = useState(null);
  const [scanQuality, setScanQuality] = useState(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [surfaceType, setSurfaceType] = useState(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const trackRef = useRef(null);

  const textures = [
    { id: 'paint-white', name: 'Matte White', color: '#f8f9fa', type: 'solid', roughness: 0.8 },
    { id: 'paint-beige', name: 'Warm Beige', color: '#f5e6d3', type: 'solid', roughness: 0.8 },
    { id: 'paint-gray', name: 'Soft Gray', color: '#d1d5db', type: 'solid', roughness: 0.8 },
    { id: 'paint-blue', name: 'Sky Blue', color: '#bfdbfe', type: 'solid', roughness: 0.8 },
    { id: 'paint-sage', name: 'Sage Green', color: '#c2e0c6', type: 'solid', roughness: 0.8 },
    { id: 'brick-red', name: 'Red Brick', color: '#b91c1c', type: 'brick', roughness: 0.9 },
    { id: 'brick-cream', name: 'Cream Brick', color: '#d4a574', type: 'brick', roughness: 0.9 },
    { id: 'wood-oak', name: 'Light Oak', color: '#d97706', type: 'wood', roughness: 0.6 },
    { id: 'wood-walnut', name: 'Dark Walnut', color: '#78350f', type: 'wood', roughness: 0.6 },
    { id: 'wallpaper-floral', name: 'Floral', color: '#fce7f3', type: 'pattern', roughness: 0.7 },
    { id: 'wallpaper-geometric', name: 'Geometric', color: '#dbeafe', type: 'pattern', roughness: 0.7 },
    { id: 'concrete', name: 'Industrial Concrete', color: '#9ca3af', type: 'solid', roughness: 0.95 },
    { id: 'stone', name: 'Stone', color: '#a1a1a1', type: 'brick', roughness: 0.95 },
    { id: 'marble', name: 'Marble', color: '#f3f4f6', type: 'pattern', roughness: 0.3 }
  ];

  const elementTypes = [
    { type: 'outlet', icon: '⚡', color: '#ef4444', width: 0.04, height: 0.07 },
    { type: 'switch', icon: '💡', color: '#f59e0b', width: 0.035, height: 0.065 },
    { type: 'window', icon: '🪟', color: '#3b82f6', width: 0.3, height: 0.3 },
    { type: 'door', icon: '🚪', color: '#8b5cf6', width: 0.35, height: 0.95 }
  ];

  useEffect(() => {
    if (!autoRotate || !roomModel) return;
    const interval = setInterval(() => {
      setRotation(prev => ({
        ...prev,
        y: (prev.y + 1) % 360
      }));
    }, 50);
    return () => clearInterval(interval);
  }, [autoRotate, roomModel]);

  const analyzeWallSurface = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return null;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let brightness = 0;
    let colorHistogram = { r: 0, g: 0, b: 0 };
    let edgeCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      brightness += (r + g + b) / 3;
      colorHistogram.r += r;
      colorHistogram.g += g;
      colorHistogram.b += b;
    }
    brightness /= (data.length / 4);
    colorHistogram.r /= (data.length / 4);
    colorHistogram.g /= (data.length / 4);
    colorHistogram.b /= (data.length / 4);
    for (let y = 1; y < canvas.height - 1; y++) {
      for (let x = 1; x < canvas.width - 1; x++) {
        const idx = (y * canvas.width + x) * 4;
        const gx = Math.abs(data[idx] - data[idx + 4]) + Math.abs(data[idx + canvas.width * 4] - data[idx]);
        if (gx > 50) edgeCount++;
      }
    }
    const edgeDensity = edgeCount / (canvas.width * canvas.height);
    const wallQuality = Math.max(0, Math.min(1, (1 - edgeDensity) * 0.8 + brightness / 255 * 0.2));
    let type = 'wall';
    if (edgeDensity < 0.1) {
      type = 'smooth-wall';
    } else if (edgeDensity > 0.25) {
      type = 'complex-scene';
    } else if (edgeDensity > 0.15) {
      type = 'textured-surface';
    }
    return {
      brightness: Math.round(brightness),
      edgeDensity: edgeDensity.toFixed(2),
      surfaceType: type,
      wallQuality: Math.round(wallQuality * 100)
    };
  }, []);

  const detectWallElementsML = useCallback(async () => {
    if (!videoRef.current) return [];
    try {
      await loadYOLOModel();
      const predictions = await detectWithYOLO(videoRef.current);
      console.log('YOLO predictions:', predictions);
      return predictions;
    } catch (err) {
      console.error('ML detection error:', err);
      return [];
    }
  }, []);

  const detectWallElements = useCallback(async () => {
    if (!videoRef.current) return [];
    try {
      const mlElements = await detectWallElementsML();
      if (mlElements.length > 0) {
        return mlElements;
      }
      return [];
    } catch (err) {
      console.error('Detection error:', err);
      return [];
    }
  }, [detectWallElementsML]);

  const startCamera = async () => {
    try {
      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        trackRef.current = stream.getVideoTracks()[0];
        setCameraActive(true);
      }
    } catch (err) {
      console.error('Camera access error:', err);
      alert('Camera access denied. Ensure you have granted camera permissions.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      trackRef.current = null;
      setCameraActive(false);
      setTorchEnabled(false);
    }
  };

  const toggleTorch = async () => {
    if (!trackRef.current) return;
    try {
      const capabilities = trackRef.current.getCapabilities ? trackRef.current.getCapabilities() : {};
      if (capabilities.torch !== undefined) {
        await trackRef.current.applyConstraints({
          advanced: [{ torch: !torchEnabled }]
        });
        setTorchEnabled(!torchEnabled);
      } else {
        try {
          await trackRef.current.applyConstraints({
            advanced: [{ torch: !torchEnabled }]
          });
          setTorchEnabled(!torchEnabled);
        } catch (e) {
          alert('Torch not supported on this device');
        }
      }
    } catch (err) {
      alert('Unable to control torch.');
    }
  };

  const startScanning = async () => {
    setIsScanning(true);
    setScanProgress(0);
    setDetectedElements([]);
    setSurfaceType(null);
    setSidebarOpen(false);
    await startCamera();
    const analysisInterval = setInterval(async () => {
      const analysis = await analyzeWallSurface();
      if (analysis) {
        setSurfaceType(analysis.surfaceType);
        setScanQuality(analysis.wallQuality);
      }
    }, 500);
    const progressInterval = setInterval(() => {
      setScanProgress(prev => {
        const newProgress = Math.min(prev + 1.5, 100);
        if (newProgress >= 100) {
          clearInterval(progressInterval);
          clearInterval(analysisInterval);
          console.log('Scan progress complete!');
        }
        return newProgress;
      });
    }, 100);
  };

  const captureWall = async () => {
    if (isCapturing) return;
    console.log('Capture Wall clicked!');
    setIsCapturing(true);
    try {
      const elements = await detectWallElements();
      console.log('Detected elements:', elements);
      const newWall = {
        id: Date.now(),
        elements,
        texture: selectedTexture,
        dimensions: { width: 3.5, height: 2.7 },
        position: walls.length,
        surfaceType: surfaceType || 'wall',
        quality: scanQuality
      };
      const updatedWalls = [...walls, newWall];
      setWalls(updatedWalls);
      setDetectedElements(elements);
      console.log('Wall captured:', newWall);
      if (updatedWalls.length >= 2) {
        generateRoomModel(updatedWalls);
      }
      setScanProgress(0);
      setIsScanning(false);
      stopCamera();
    } catch (error) {
      console.error('Error capturing wall:', error);
      alert('Error capturing wall: ' + error.message);
    } finally {
      setIsCapturing(false);
    }
  };

  const generateRoomModel = (wallList) => {
    const roomHeight = 2.7;
    const roomWidth = 3.5;
    const roomDepth = 3.5;
    setRoomModel({
      width: roomWidth,
      depth: roomDepth,
      height: roomHeight,
      walls: wallList,
      generatedAt: new Date().toISOString()
    });
  };

  const resetScanner = () => {
    setWalls([]);
    setDetectedElements([]);
    setScanProgress(0);
    setIsScanning(false);
    setRoomModel(null);
    setSurfaceType(null);
    setScanQuality(0);
    stopCamera();
  };

  const renderTexture = (textureId) => {
    const texture = textures.find(t => t.id === textureId);
    if (!texture) return { backgroundColor: '#f8f9fa' };
    const patterns = {
      brick: {
        background: `repeating-linear-gradient(0deg, ${texture.color} 0px, ${texture.color} 20px, #5a2c2c 20px, #5a2c2c 22px), repeating-linear-gradient(90deg, ${texture.color} 0px, ${texture.color} 60px, #5a2c2c 60px, #5a2c2c 62px)`
      },
      wood: {
        background: `repeating-linear-gradient(90deg, ${texture.color}, ${texture.color} 8px, #6b3410 8px, #6b3410 12px)`
      },
      pattern: {
        background: `radial-gradient(circle at 20% 50%, rgba(236,72,153,0.6) 2px, transparent 2px), radial-gradient(circle at 80% 80%, rgba(249,168,212,0.6) 2px, transparent 2px), ${texture.color}`
      }
    };
    return patterns[texture.type] || { backgroundColor: texture.color };
  };

  const render3DView = () => {
    if (!roomModel) return null;
    const { width, depth, height, walls: roomWalls } = roomModel;
    const scale = 60;
    const perspective = 800;
    const rad = (deg) => (deg * Math.PI) / 180;
    const transform3D = (x, y, z) => {
      let point = { x, y, z };
      const cosX = Math.cos(rad(rotation.x));
      const sinX = Math.sin(rad(rotation.x));
      const y1 = point.y * cosX - point.z * sinX;
      const z1 = point.y * sinX + point.z * cosX;
      point = { x: point.x, y: y1, z: z1 };
      const cosY = Math.cos(rad(rotation.y));
      const sinY = Math.sin(rad(rotation.y));
      const x2 = point.x * cosY + point.z * sinY;
      const z2 = -point.x * sinY + point.z * cosY;
      point = { x: x2, y: point.y, z: z2 };
      const scaleProj = perspective / (perspective + point.z);
      return {
        x: point.x * scale * scaleProj,
        y: point.y * scale * scaleProj,
        z: point.z
      };
    };
    const wallFaces = [
      {
        name: 'Front',
        points: [[-width/2, -height/2, depth/2], [width/2, -height/2, depth/2], [width/2, height/2, depth/2], [-width/2, height/2, depth/2]],
        wall: roomWalls[0]
      },
      {
        name: 'Right',
        points: [[width/2, -height/2, depth/2], [width/2, -height/2, -depth/2], [width/2, height/2, -depth/2], [width/2, height/2, depth/2]],
        wall: roomWalls[1]
      },
      {
        name: 'Back',
        points: [[width/2, -height/2, -depth/2], [-width/2, -height/2, -depth/2], [-width/2, height/2, -depth/2], [width/2, height/2, -depth/2]],
        wall: roomWalls[2]
      },
      {
        name: 'Left',
        points: [[-width/2, -height/2, -depth/2], [-width/2, -height/2, depth/2], [-width/2, height/2, depth/2], [-width/2, height/2, -depth/2]],
        wall: roomWalls[3]
      },
      {
        name: 'Floor',
        points: [[-width/2, -height/2, depth/2], [width/2, -height/2, depth/2], [width/2, -height/2, -depth/2], [-width/2, -height/2, -depth/2]],
        color: '#94a3b8'
      },
      {
        name: 'Ceiling',
        points: [[-width/2, height/2, depth/2], [width/2, height/2, depth/2], [width/2, height/2, -depth/2], [-width/2, height/2, -depth/2]],
        color: '#e2e8f0'
      }
    ];
    const transformed = wallFaces.map(face => ({
      ...face,
      transformedPoints: face.points.map(p => transform3D(...p)),
      avgZ: face.points.reduce((sum, p) => sum + transform3D(...p).z, 0) / face.points.length
    }));
    transformed.sort((a, b) => a.avgZ - b.avgZ);
    return (
      <div className="relative w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-700">
        <svg width="100%" height="100%" viewBox="-300 -200 600 400" className="overflow-visible w-full h-full" preserveAspectRatio="xMidYMid meet">
          {transformed.map((face, i) => {
            const points = face.transformedPoints;
            const pathData = `M ${points[0].x} ${points[0].y} ${points.map(p => `L ${p.x} ${p.y}`).join(' ')} Z`;
            const texture = face.wall ? textures.find(t => t.id === face.wall.texture) : null;
            const fillColor = texture ? texture.color : face.color;
            return (
              <g key={i}>
                <path d={pathData} fill={fillColor} stroke="#1e293b" strokeWidth="2" opacity={face.name === 'Floor' || face.name === 'Ceiling' ? 0.6 : 0.9} />
                {face.wall && face.wall.elements.map((el, j) => {
                  const elType = elementTypes.find(t => t.type === el.type);
                  const elX = (el.x - 0.5) * (points[1].x - points[0].x) + (points[0].x + points[1].x) / 2;
                  const elY = (el.y - 0.5) * (points[2].y - points[0].y) + (points[0].y + points[2].y) / 2;
                  return (
                    <g key={j}>
                      <circle cx={elX} cy={elY} r="10" fill={elType?.color} stroke="#fff" strokeWidth="2" opacity="0.8" />
                      <text x={elX} y={elY + 4} textAnchor="middle" fontSize="12" fill="#fff" fontWeight="bold">
                        {elType?.icon}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
        <div className="absolute bottom-2 sm:bottom-4 right-2 sm:right-4 bg-black/70 text-white px-3 sm:px-4 py-2 sm:py-3 rounded-lg text-xs sm:text-sm">
          <p className="font-semibold">{width}m × {depth}m × {height}m</p>
          <p className="text-xs text-slate-300 mt-1">Surfaces: {roomWalls.length}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full h-screen bg-slate-900 flex flex-col overflow-hidden">
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 border-b border-slate-600 p-2 sm:p-4 shadow-lg">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <div className="bg-blue-600 p-1.5 sm:p-2 rounded-lg flex-shrink-0">
              <Box className="text-white" size={20} />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-lg sm:text-2xl font-bold text-white">AI Wall Scanner</h1>
              <p className="text-xs sm:text-sm text-slate-400">Real-time 3D Room Modeling</p>
            </div>
            <div className="sm:hidden">
              <h1 className="text-base font-bold text-white">Wall Scanner</h1>
            </div>
          </div>

          <div className="hidden lg:flex gap-2">
            <button
              onClick={() => { setViewMode('scan'); setSidebarOpen(false); }}
              className={`px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 transition font-medium text-sm ${
                viewMode === 'scan' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/50' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              <Camera size={18} />
              Scan
            </button>
            <button
              onClick={() => { setViewMode('3d'); setSidebarOpen(false); }}
              disabled={walls.length === 0}
              className={`px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 transition font-medium text-sm ${
                viewMode === '3d' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/50' : 'bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50'
              }`}
            >
              <Layers size={18} />
              3D View
            </button>
            <button
              onClick={() => { setViewMode('materials'); setSidebarOpen(false); }}
              className={`px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 transition font-medium text-sm ${
                viewMode === 'materials' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/50' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              <Paintbrush size={18} />
              Materials
            </button>
          </div>

          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden bg-slate-700 text-white p-2 rounded-lg hover:bg-slate-600 transition flex-shrink-0"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden gap-0 flex-col lg:flex-row">
        {sidebarOpen && <div className="fixed inset-0 bg-black/40 lg:hidden z-30" onClick={() => setSidebarOpen(false)} />}
        
        <div className={`fixed lg:relative top-0 left-0 h-screen lg:h-auto w-72 sm:w-80 lg:w-96 bg-slate-800 border-r border-slate-700 p-4 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-700 transform transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0 z-40' : '-translate-x-full lg:translate-x-0'
        }`}>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden absolute top-4 right-4 text-slate-300 hover:text-white"
          >
            <X size={24} />
          </button>

          <div className="space-y-4 mt-10 lg:mt-0">
            <div className="bg-gradient-to-br from-blue-900/50 to-blue-800/30 rounded-lg p-4 border border-blue-700/50">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-white flex items-center gap-2 text-sm sm:text-base">
                  <Square size={18} className="text-blue-400" />
                  Scan Status
                </h3>
                {roomModel && <span className="text-xs bg-green-600 text-white px-2 py-1 rounded">Ready</span>}
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-blue-400 mb-1">{walls.length}</div>
              <p className="text-xs text-slate-400">surfaces captured</p>

              {scanProgress > 0 && scanProgress < 100 && (
                <div className="mt-4">
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-slate-400">Scanning...</span>
                    <span className="text-xs text-blue-400 font-semibold">{scanProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden">
                    <div className="bg-gradient-to-r from-blue-500 to-cyan-400 h-2.5 rounded-full transition-all" style={{ width: `${scanProgress}%` }} />
                  </div>
                </div>
              )}

              {surfaceType && (
                <div className="mt-3 pt-3 border-t border-slate-600 text-xs space-y-1">
                  <p className="text-slate-300">Type: <span className="text-blue-400 font-semibold capitalize">{surfaceType.replace('-', ' ')}</span></p>
                  <p className="text-slate-300">Quality: <span className="text-blue-400 font-semibold">{scanQuality}%</span></p>
                  <p className="text-slate-300 flex items-center gap-1 mt-2">
                    <Brain size={12} className="text-purple-400" />
                    <span className="text-purple-400">ML Detection Active</span>
                  </p>
                </div>
              )}
            </div>

            {detectedElements.length > 0 && (
              <div className="bg-slate-700 rounded-lg p-4 border border-slate-600">
                <h3 className="font-semibold text-white mb-3 text-sm">Detected Elements</h3>
                <div className="grid grid-cols-2 gap-2">
                  {elementTypes.map(type => {
                    const count = detectedElements.filter(el => el.type === type.type).length;
                    return (
                      <div key={type.type} className={`p-2 rounded text-center text-xs ${count > 0 ? 'bg-slate-600 border border-slate-500' : 'bg-slate-800 border border-slate-700'}`}>
                        <div className="text-lg mb-1">{type.icon}</div>
                        <div className="text-xs font-semibold text-white">{count}x {type.type}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {walls.length > 0 && (
              <div className="bg-slate-700 rounded-lg p-4 border border-slate-600">
                <h3 className="font-semibold text-white mb-3 text-sm flex items-center gap-2">
                  <Layers size={16} />
                  Captured Surfaces
                </h3>
                <div className="space-y-2">
                  {walls.map((wall, i) => (
                    <div key={wall.id} className="bg-slate-600 rounded p-3 border border-slate-500">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white font-medium text-sm">Surface {i + 1}</span>
                        <span className="text-xs bg-slate-500 text-slate-200 px-2 py-1 rounded capitalize">{wall.surfaceType.replace('-', ' ')}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-300 mb-2">
                        <span>Quality: {wall.quality}%</span>
                        <span>{wall.elements.length} elements</span>
                      </div>
                      <div className="h-12 rounded bg-slate-700 border border-slate-500" style={renderTexture(wall.texture)} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2 pt-2 border-t border-slate-600">
              {!isScanning ? (
                <button
                  onClick={startScanning}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white py-2 sm:py-3 rounded-lg flex items-center justify-center gap-2 transition font-semibold shadow-lg text-sm"
                >
                  <Camera size={18} />
                  Start Scanning
                </button>
              ) : (
                <>
                  <button
                    onClick={captureWall}
                    disabled={scanProgress < 100 || isCapturing}
                    className="w-full bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-white py-2 rounded-lg flex items-center justify-center gap-2 transition font-semibold text-sm"
                  >
                    <Plus size={18} />
                    Capture ({scanProgress}%)
                  </button>
                  {cameraActive && (
                    <button
                      onClick={toggleTorch}
                      className={`w-full py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition font-medium text-sm ${
                        torchEnabled ? 'bg-yellow-600 text-white' : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      💡 {torchEnabled ? 'Torch On' : 'Torch Off'}
                    </button>
                  )}
                </>
              )}

              {walls.length > 0 && (
                <button
                  onClick={resetScanner}
                  className="w-full bg-slate-700 hover:bg-slate-600 text-white py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition font-medium text-sm"
                >
                  <RotateCcw size={18} />
                  Reset All
                </button>
              )}

              {roomModel && (
                <>
                  <button
                    onClick={() => {
                      const data = JSON.stringify(roomModel, null, 2);
                      const blob = new Blob([data], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `room-model-${Date.now()}.json`;
                      a.click();
                    }}
                    className="w-full bg-slate-700 hover:bg-slate-600 text-white py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition font-medium text-sm"
                  >
                    <Download size={16} />
                    Export Model
                  </button>
                  <button
                    className="w-full bg-slate-700 hover:bg-slate-600 text-white py-2 px-3 rounded-lg flex items-center justify-center gap-2 transition font-medium text-sm"
                  >
                    <Share2 size={16} />
                    Share
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 relative bg-slate-700 flex flex-col lg:flex-row">
          <div className="hidden lg:flex gap-2 absolute top-4 left-4 z-10 flex-wrap">
            <button
              onClick={() => { setViewMode('scan'); setSidebarOpen(false); }}
              className={`px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 transition font-medium text-sm ${
                viewMode === 'scan' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/50' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              <Camera size={18} />
              Scan
            </button>
            <button
              onClick={() => { setViewMode('3d'); setSidebarOpen(false); }}
              disabled={walls.length === 0}
              className={`px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 transition font-medium text-sm ${
                viewMode === '3d' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/50' : 'bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50'
              }`}
            >
              <Layers size={18} />
              3D View
            </button>
            <button
              onClick={() => { setViewMode('materials'); setSidebarOpen(false); }}
              className={`px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 transition font-medium text-sm ${
                viewMode === 'materials' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/50' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              <Paintbrush size={18} />
              Materials
            </button>
          </div>

          {/* Tab buttons for mobile/tablet */}
          <div className="lg:hidden flex gap-1 sm:gap-2 p-2 bg-slate-700 border-b border-slate-600 overflow-x-auto">
            <button
              onClick={() => { setViewMode('scan'); setSidebarOpen(false); }}
              className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg flex items-center gap-1 transition font-medium text-xs sm:text-sm whitespace-nowrap ${
                viewMode === 'scan' ? 'bg-blue-600 text-white' : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
              }`}
            >
              <Camera size={16} />
              Scan
            </button>
            <button
              onClick={() => { setViewMode('3d'); setSidebarOpen(false); }}
              disabled={walls.length === 0}
              className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg flex items-center gap-1 transition font-medium text-xs sm:text-sm whitespace-nowrap ${
                viewMode === '3d' ? 'bg-blue-600 text-white' : 'bg-slate-600 text-slate-300 hover:bg-slate-500 disabled:opacity-50'
              }`}
            >
              <Layers size={16} />
              3D
            </button>
            <button
              onClick={() => { setViewMode('materials'); setSidebarOpen(false); }}
              className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg flex items-center gap-1 transition font-medium text-xs sm:text-sm whitespace-nowrap ${
                viewMode === 'materials' ? 'bg-blue-600 text-white' : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
              }`}
            >
              <Paintbrush size={16} />
              Materials
            </button>
          </div>

          {viewMode === 'scan' && (
            <div className="w-full h-full flex items-center justify-center relative bg-black">
              {isScanning ? (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  <canvas ref={canvasRef} className="hidden" />

                  <div className="absolute inset-0 pointer-events-none">
                    <svg className="w-full h-full" preserveAspectRatio="none">
                      {detectedElements.map((el, i) => {
                        const elType = elementTypes.find(t => t.type === el.type);
                        const xPct = el.x * 100;
                        const yPct = el.y * 100;
                        const wPct = el.width * 100;
                        const hPct = el.height * 100;

                        return (
                          <g key={i}>
                            <rect
                              x={`${xPct}%`}
                              y={`${yPct}%`}
                              width={`${wPct}%`}
                              height={`${hPct}%`}
                              fill="none"
                              stroke={elType?.color || 'yellow'}
                              strokeWidth="3"
                              rx="8"
                            />
                            <rect
                              x={`${xPct}%`}
                              y={`${Math.max(yPct - 6, 0)}%`}
                              width={`${Math.min(wPct + 5, 35)}%`}
                              height="6%"
                              fill={elType?.color || 'yellow'}
                              opacity="0.9"
                              rx="4"
                            />
                            <text
                              x={`${xPct + 0.5}%`}
                              y={`${Math.max(yPct - 2.5, 1)}%`}
                              fill="#fff"
                              fontSize="11"
                              fontWeight="bold"
                              alignmentBaseline="hanging"
                            >
                              {el.type.toUpperCase()}
                            </text>
                            <text
                              x={`${xPct + wPct / 2}%`}
                              y={`${yPct + hPct / 2}%`}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              fontSize="18"
                            >
                              {elType?.icon}
                            </text>
                          </g>
                        );
                      })}
                    </svg>

                    <div className="absolute inset-4 sm:inset-8 border-2 border-blue-500 rounded-2xl">
                      <div className="absolute -top-1 -left-1 w-4 sm:w-6 h-4 sm:h-6 border-t-3 border-l-3 border-blue-500 rounded-tl-lg" />
                      <div className="absolute -top-1 -right-1 w-4 sm:w-6 h-4 sm:h-6 border-t-3 border-r-3 border-blue-500 rounded-tr-lg" />
                      <div className="absolute -bottom-1 -left-1 w-4 sm:w-6 h-4 sm:h-6 border-b-3 border-l-3 border-blue-500 rounded-bl-lg" />
                      <div className="absolute -bottom-1 -right-1 w-4 sm:w-6 h-4 sm:h-6 border-b-3 border-r-3 border-blue-500 rounded-br-lg" />
                    </div>

                    <div className="absolute inset-4 sm:inset-8 rounded-2xl" style={{
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                    }} />
                  </div>

                  <div className="absolute top-2 sm:top-4 left-1/2 -translate-x-1/2 bg-black/80 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg backdrop-blur-sm flex items-center gap-2 text-sm sm:text-base">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="font-semibold">AI Scanning Active</span>
                  </div>

                  <div className="absolute top-2 sm:top-4 right-2 sm:right-4 bg-black/80 text-white px-3 sm:px-4 py-2 sm:py-3 rounded-lg backdrop-blur-sm text-xs sm:text-sm">
                    <div className="font-semibold mb-1">Surface Quality</div>
                    <div className="flex items-center gap-2">
                      <div className="w-20 sm:w-24 h-2 bg-slate-600 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-green-500 to-blue-500 transition-all"
                          style={{ width: `${scanQuality}%` }}
                        />
                      </div>
                      <span className="font-bold text-blue-400">{scanQuality}%</span>
                    </div>
                  </div>

                  <div className="absolute bottom-2 sm:bottom-4 left-1/2 -translate-x-1/2 bg-black/80 text-white px-3 sm:px-4 py-2 rounded-lg backdrop-blur-sm text-xs sm:text-sm text-center max-w-xs sm:max-w-sm">
                    Keep camera steady. Point at surface features. Wait for 100% completion.
                  </div>
                </>
              ) : (
                <div className="text-center text-slate-300 space-y-4 sm:space-y-6 px-4">
                  <div className="relative w-24 sm:w-32 h-24 sm:h-32 mx-auto">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-600/20 to-blue-500/10 rounded-3xl blur-2xl" />
                    <div className="relative flex items-center justify-center w-full h-full">
                      <Camera size={60} className="opacity-40 sm:w-20 sm:h-20" />
                    </div>
                  </div>
                  <div>
                    <p className="text-xl sm:text-2xl font-bold text-white mb-2">Ready to Scan</p>
                    <p className="text-slate-400 max-w-md mx-auto text-sm sm:text-base">Position camera perpendicular to surface and click "Start Scanning" to begin real-time detection.</p>
                  </div>
                  {walls.length === 0 && (
                    <div className="flex items-center justify-center gap-2 text-yellow-500 text-xs sm:text-sm bg-yellow-500/10 px-3 sm:px-4 py-2 rounded-lg mx-auto max-w-sm">
                      <AlertCircle size={16} />
                      <span>Requires camera permissions</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {viewMode === '3d' && (
            <div className="w-full h-full relative">
              {roomModel && walls.length > 0 ? (
                <>
                  {render3DView()}
                  <div className="absolute top-4 right-2 sm:right-4 space-y-2 sm:space-y-3 z-10">
                    <button
                      onClick={() => setAutoRotate(!autoRotate)}
                      className="bg-black/70 hover:bg-black/90 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition backdrop-blur-sm border border-slate-600 w-full sm:w-auto"
                    >
                      {autoRotate ? '⏸️ Pause' : '▶️ Auto'} Rotate
                    </button>
                    <div className="bg-black/70 text-white px-3 sm:px-4 py-3 sm:py-4 rounded-lg text-xs sm:text-sm backdrop-blur-sm border border-slate-600">
                      <label className="block mb-2 sm:mb-3">
                        <div className="font-semibold mb-1 sm:mb-2 text-xs sm:text-sm">Rotation X: {rotation.x}°</div>
                        <input
                          type="range"
                          min="-90"
                          max="90"
                          value={rotation.x}
                          onChange={(e) => setRotation(prev => ({ ...prev, x: Number(e.target.value) }))}
                          className="w-32 sm:w-40"
                        />
                      </label>
                      <label className="block">
                        <div className="font-semibold mb-1 sm:mb-2 text-xs sm:text-sm">Rotation Y: {rotation.y}°</div>
                        <input
                          type="range"
                          min="0"
                          max="360"
                          value={rotation.y}
                          onChange={(e) => setRotation(prev => ({ ...prev, y: Number(e.target.value) }))}
                          className="w-32 sm:w-40"
                        />
                      </label>
                    </div>
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-400">
                  <div className="text-center space-y-4 px-4">
                    <Layers size={60} className="mx-auto opacity-20 sm:w-20 sm:h-20" />
                    <div>
                      <p className="text-lg sm:text-xl font-bold text-white mb-1">3D Room Not Available</p>
                      <p className="text-slate-400 text-sm sm:text-base">Capture at least 2 surfaces to generate 3D model</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {viewMode === 'materials' && (
            <div className="w-full h-full bg-slate-800 overflow-y-auto p-4 sm:p-8">
              <div className="max-w-6xl mx-auto">
                <div className="mb-6 sm:mb-8">
                  <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">Material Library</h2>
                  <p className="text-slate-400 text-sm sm:text-base">Browse and apply textures to surfaces</p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
                  {textures.map(texture => (
                    <button
                      key={texture.id}
                      onClick={() => setSelectedTexture(texture.id)}
                      className={`relative h-32 sm:h-40 rounded-xl overflow-hidden transition-all group ${
                        selectedTexture === texture.id
                          ? 'ring-2 ring-blue-500 shadow-xl shadow-blue-500/30'
                          : 'ring-1 ring-slate-600 hover:ring-slate-500'
                      }`}
                    >
                      <div className="w-full h-full" style={renderTexture(texture.id)} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex items-end p-2 sm:p-3">
                        <div className="text-left">
                          <p className="text-white font-semibold text-xs sm:text-sm">{texture.name}</p>
                          <p className="text-slate-300 text-xs">{texture.type}</p>
                        </div>
                      </div>
                      {selectedTexture === texture.id && (
                        <div className="absolute top-2 right-2 bg-blue-600 text-white w-5 sm:w-6 h-5 sm:h-6 rounded-full flex items-center justify-center text-xs sm:text-sm">
                          ✓
                        </div>
                      )}
                    </button>
                  ))}
                </div>

                {walls.length > 0 && (
                  <div>
                    <h3 className="text-xl sm:text-2xl font-bold text-white mb-3 sm:mb-4">Apply to Surfaces</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                      {walls.map((wall, i) => (
                        <div key={wall.id} className="bg-slate-700 rounded-lg p-4 sm:p-5 border border-slate-600 hover:border-slate-500 transition">
                          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 sm:mb-4 gap-2 sm:gap-4">
                            <div>
                              <p className="text-white font-semibold text-sm sm:text-base">Surface {i + 1}</p>
                              <p className="text-xs text-slate-400">{wall.surfaceType.replace('-', ' ')} • {wall.elements.length} elements</p>
                            </div>
                            <button
                              onClick={() => {
                                const updated = [...walls];
                                updated[i] = { ...updated[i], texture: selectedTexture };
                                setWalls(updated);
                                if (roomModel) generateRoomModel(updated);
                              }}
                              className="bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition w-full sm:w-auto"
                            >
                              Apply
                            </button>
                          </div>
                          <div className="h-20 sm:h-28 rounded-lg border border-slate-600 overflow-hidden" style={renderTexture(wall.texture)} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .scrollbar-thin::-webkit-scrollbar {
          width: 6px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: rgba(51, 65, 85, 0.5);
          border-radius: 10px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: rgba(100, 116, 139, 0.8);
          border-radius: 10px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: rgba(100, 116, 139, 1);
        }
      `}</style>
    </div>
  );
};

export default WallScanner3D;