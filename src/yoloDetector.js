import { InferenceSession, Tensor } from 'onnxruntime-web';

/**
 * YOLO Object Detector using ONNX Runtime Web
 * Detects: outlets, switches, windows, doors
 */

let session = null;
let modelLoading = false;

// Class mapping for YOLO model
const YOLO_CLASSES = {
  0: 'outlet',
  1: 'switch',
  2: 'window',
  3: 'door'
};

const CLASS_COLORS = {
  outlet: '#ef4444',
  switch: '#f59e0b',
  window: '#3b82f6',
  door: '#8b5cf6'
};

/**
 * Load the YOLO ONNX model
 * Replace with your actual model URL/path
 */
export async function loadYOLOModel(modelUrl = '/models/yolo-elements.onnx') {
  if (session) return session;
  if (modelLoading) {
    // Wait for model to load
    while (modelLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return session;
  }

  try {
    modelLoading = true;
    console.log('Loading YOLO model from:', modelUrl);
    
    session = await InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    console.log('YOLO model loaded successfully');
    return session;
  } catch (err) {
    console.error('Failed to load YOLO model:', err);
    session = null;
    throw err;
  } finally {
    modelLoading = false;
  }
}

/**
 * Convert canvas/video frame to tensor
 */
function frameToTensor(canvas, width = 640, height = 640) {
  const ctx = canvas.getContext('2d');
  
  // Draw and resize to model input size
  canvas.width = width;
  canvas.height = height;
  
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Convert RGBA to RGB and normalize to [0, 1]
  const tensorData = new Float32Array(width * height * 3);
  for (let i = 0; i < data.length; i += 4) {
    tensorData[(i / 4) * 3] = data[i] / 255.0;      // R
    tensorData[(i / 4) * 3 + 1] = data[i + 1] / 255.0; // G
    tensorData[(i / 4) * 3 + 2] = data[i + 2] / 255.0; // B
  }

  return new Tensor('float32', tensorData, [1, 3, height, width]);
}

/**
 * Post-process YOLO output
 * YOLO output format: [batch, num_detections, 6]
 * where each detection is [x, y, w, h, confidence, class_id]
 */
function postProcessYOLO(output, confThreshold = 0.5, iouThreshold = 0.4) {
  const detections = [];

  if (!output || output.length === 0) return detections;

  const data = output[0].data;
  const shape = output[0].dims;
  
  // Parse detections
  for (let i = 0; i < shape[1]; i++) {
    const offset = i * shape[2];
    const x = data[offset];
    const y = data[offset + 1];
    const w = data[offset + 2];
    const h = data[offset + 3];
    const confidence = data[offset + 4];
    const classId = Math.argMax(data.slice(offset + 5, offset + shape[2]));

    if (confidence > confThreshold) {
      detections.push({
        x: x - w / 2,
        y: y - h / 2,
        width: w,
        height: h,
        confidence,
        classId,
        className: YOLO_CLASSES[classId] || 'unknown'
      });
    }
  }

  // Apply NMS (Non-Maximum Suppression)
  return nms(detections, iouThreshold);
}

/**
 * Non-Maximum Suppression
 */
function nms(detections, iouThreshold = 0.4) {
  if (detections.length === 0) return [];

  // Sort by confidence descending
  detections.sort((a, b) => b.confidence - a.confidence);

  const keep = [];
  const suppressed = new Set();

  for (let i = 0; i < detections.length; i++) {
    if (suppressed.has(i)) continue;

    const det = detections[i];
    keep.push(det);

    // Suppress overlapping detections
    for (let j = i + 1; j < detections.length; j++) {
      if (suppressed.has(j)) continue;

      const iou = calculateIOU(det, detections[j]);
      if (iou > iouThreshold) {
        suppressed.add(j);
      }
    }
  }

  return keep;
}

/**
 * Calculate Intersection over Union (IOU)
 */
function calculateIOU(box1, box2) {
  const x1_min = box1.x;
  const y1_min = box1.y;
  const x1_max = box1.x + box1.width;
  const y1_max = box1.y + box1.height;

  const x2_min = box2.x;
  const y2_min = box2.y;
  const x2_max = box2.x + box2.width;
  const y2_max = box2.y + box2.height;

  const intersect_x_min = Math.max(x1_min, x2_min);
  const intersect_y_min = Math.max(y1_min, y2_min);
  const intersect_x_max = Math.min(x1_max, x2_max);
  const intersect_y_max = Math.min(y1_max, y2_max);

  if (intersect_x_min >= intersect_x_max || intersect_y_min >= intersect_y_max) {
    return 0;
  }

  const intersectArea = (intersect_x_max - intersect_x_min) * (intersect_y_max - intersect_y_min);
  const box1Area = box1.width * box1.height;
  const box2Area = box2.width * box2.height;
  const unionArea = box1Area + box2Area - intersectArea;

  return intersectArea / unionArea;
}

/**
 * Main detection function
 * Takes a video element or canvas and returns detected elements
 */
export async function detectWithYOLO(videoOrCanvas, modelUrl = '/models/yolo-elements.onnx') {
  try {
    // Ensure session is loaded
    if (!session) {
      await loadYOLOModel(modelUrl);
    }

    // Create canvas for frame capture
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (videoOrCanvas.tagName === 'VIDEO') {
      ctx.drawImage(videoOrCanvas, 0, 0, 640, 640);
    } else {
      canvas.width = videoOrCanvas.width;
      canvas.height = videoOrCanvas.height;
      ctx.drawImage(videoOrCanvas, 0, 0);
    }

    // Convert to tensor
    const tensor = frameToTensor(canvas, 640, 640);

    // Run inference
    const feeds = { images: tensor };
    const results = await session.run(feeds);

    // Get output (adjust key based on your model)
    const output = results.output0 || results.output || Object.values(results)[0];

    // Post-process
    const yoloDetections = postProcessYOLO([output], 0.5, 0.4);

    // Convert to app format
    const elements = yoloDetections
      .filter(det => det.className !== 'unknown')
      .map((det, idx) => ({
        id: idx,
        type: det.className,
        x: det.x / 640,
        y: det.y / 640,
        width: det.width / 640,
        height: det.height / 640,
        confidence: det.confidence,
        depth: det.className === 'window' ? -0.1 : 0.05,
        color: CLASS_COLORS[det.className]
      }));

    console.log('YOLO detections:', elements);
    return elements;
  } catch (err) {
    console.error('YOLO detection error:', err);
    return [];
  }
}

/**
 * Unload model to free memory
 */
export async function unloadYOLOModel() {
  if (session) {
    await session.release();
    session = null;
  }
}

export { CLASS_COLORS, YOLO_CLASSES };
