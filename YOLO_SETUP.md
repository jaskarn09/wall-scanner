# YOLO Model Setup Guide

## Overview
Your wall-scanner app now uses a custom YOLO model instead of COCO-SSD for detecting:
- Outlets ⚡
- Light switches 💡
- Windows 🪟
- Doors 🚪

## Step 1: Download/Export YOLO Model

### Option A: Use Pre-trained Roboflow Models (Recommended for Quick Start)

Visit these Roboflow datasets and export as ONNX:

1. **Outlets**: https://universe.roboflow.com/utility1/outlet-detection
2. **Switches**: https://universe.roboflow.com/smart-home/light-switch-detection
3. **Windows & Doors**: https://universe.roboflow.com/home-detection/windows-and-doors

Steps to export:
1. Go to the Roboflow dataset page
2. Click "Download" → Select "YOLOv8" format
3. Export as ONNX (or TensorFlow.js)
4. Download the model files

### Option B: Train Your Own YOLO Model

Use Roboflow + YOLOv8:

```bash
# Install dependencies
pip install ultralytics roboflow

# Download dataset from Roboflow
python -c "from roboflow import Roboflow; rf = Roboflow(api_key='YOUR_API_KEY'); project = rf.workspace().project('project-name'); dataset = project.download('yolov8')"

# Train model
yolo detect train data=data.yaml model=yolov8n.pt epochs=100 imgsz=640

# Export to ONNX
yolo export model=runs/detect/train/weights/best.pt format=onnx
```

## Step 2: Place Model in Public Folder

1. Create a `models` folder in `public/`:
   ```
   public/
   ├── models/
   │   └── yolo-elements.onnx
   ```

2. Copy your ONNX model file to `public/models/yolo-elements.onnx`

## Step 3: Configure Model Path (Optional)

The default model path is `/models/yolo-elements.onnx`.

If your model is at a different location, update in `App.js`:

```javascript
// In detectWallElementsML function
const predictions = await detectWithYOLO(videoRef.current, '/your-custom-path/model.onnx');
```

## Step 4: Handle ONNX Runtime Wasm Files

ONNX Runtime Web needs WebAssembly files. They're auto-downloaded from CDN, but you can also:

1. Install locally:
```bash
npm install onnxruntime-web
```

2. Copy wasm files to public:
```bash
cp node_modules/onnxruntime-web/dist/ort-wasm.wasm public/
cp node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm public/
```

3. Configure in code:
```javascript
import { InferenceSession } from 'onnxruntime-web';
InferenceSession.create('/yolo-elements.onnx', {
  executionProviders: ['wasm'],
});
```

## Step 5: Test the App

```bash
npm start
```

1. Open http://localhost:3000
2. Click "Start Scanning"
3. Wait for progress to reach 100%
4. Click "Capture Surface"
5. The app will now use YOLO for detection instead of COCO-SSD

## Model Output Format

Your ONNX model should output detections in one of these formats:

### Format 1: [batch, num_detections, 6]
```
[x, y, w, h, confidence, class_id]
```

### Format 2: [batch, 6, height, width] (YOLOv8 format)
Grid-based predictions (handled by post-processing)

## Class Mapping

The model expects these class IDs:
- `0` = outlet
- `1` = switch
- `2` = window
- `3` = door

Edit `yoloDetector.js` if your model uses different class IDs:

```javascript
const YOLO_CLASSES = {
  0: 'outlet',
  1: 'switch',
  2: 'window',
  3: 'door'
};
```

## Troubleshooting

### Model Won't Load
- Check console for CORS errors
- Ensure `public/models/yolo-elements.onnx` exists
- Verify ONNX Runtime files are available

### No Detections
- Check confidence threshold (currently 0.5)
- Verify model class IDs match your dataset
- Check console logs for model output shape

### Performance Issues
- Reduce image size (currently 640x640)
- Use smaller model (YOLOv8n instead of YOLOv8m)
- Adjust inference frequency (currently every capture)

## Next Steps

1. ✅ Download/export YOLO model from Roboflow
2. ✅ Place in `public/models/yolo-elements.onnx`
3. ✅ Test detection by capturing surface
4. ✅ Fine-tune confidence/class thresholds as needed
5. Deploy and use!

## Performance Notes

- **Model Size**: ~25-50MB for YOLOv8n ONNX
- **Inference Time**: ~300-500ms per frame on GPU, ~1-2s on CPU
- **Accuracy**: ~85-95% depending on training dataset
- **Real-time**: Can run every frame or subsample (e.g., every 5 frames)

For faster inference, consider:
- Using YOLOv8n (nano) instead of larger models
- Running on GPU (WebGPU support coming)
- Quantization (int8) to reduce model size
