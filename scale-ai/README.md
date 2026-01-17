# Scale AI - Data Labeling & ML Training Platform

A crowdsourced data collection platform where users contribute labeled drawing data through a game interface, administrators manage datasets and training, and implementors use trained models for inference.

## Project Overview

**Three User Portals:**

1. **Drawing Game (End Users)** - Draw shapes (line, heart, circle, square, triangle) on a canvas
2. **Admin Dashboard** - View statistics, browse data, trigger model training
3. **Implementor Portal** - Load trained model, test inference, generate shapes

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.10+
- Docker & Docker Compose

### 1. Start Infrastructure

```bash
cd scale-ai
docker-compose up -d
```

This starts:
- PostgreSQL (port 5432) - metadata storage
- MinIO (ports 9000, 9001) - object storage (auto-creates `drawings` and `models` buckets)
- RabbitMQ (ports 5672, 15672) - message queue for training jobs

### 2. Setup Backend

```bash
cd backend
npm install
npm run db:migrate   # Creates tables and seeds shape data
```

### 3. Start Backend Services

```bash
# Option A: Run all services with one command
npm run dev

# Option B: Run services individually
npm run dev:collection   # Port 3001
npm run dev:admin        # Port 3002
npm run dev:inference    # Port 3003
```

### 4. Start Frontend

```bash
cd frontend
npm install
npm run dev   # Port 5173
```

### 5. Access the Application

- **Drawing Game:** http://localhost:5173
- **Admin Dashboard:** http://localhost:5173/#admin
- **Model Tester:** http://localhost:5173/#implement

### 6. (Optional) Start Training Worker

Only needed when you want to train models:

```bash
cd training
pip install -r requirements.txt
python worker.py
```

## Project Structure

```
scale-ai/
├── frontend/                    # React + TypeScript + Vite
│   ├── src/
│   │   ├── components/
│   │   │   └── PostItCanvas/   # Skeuomorphic drawing canvas
│   │   ├── routes/
│   │   │   ├── admin/          # Admin dashboard
│   │   │   └── implement/      # Model tester portal
│   │   ├── services/
│   │   │   └── api.ts          # API client
│   │   ├── App.tsx             # Main app with routing
│   │   └── App.css             # Global styles
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── collection/         # Drawing collection service (port 3001)
│   │   ├── admin/              # Admin service (port 3002)
│   │   ├── inference/          # Model inference service (port 3003)
│   │   ├── shared/             # Shared DB, storage, queue clients
│   │   └── db/
│   │       └── migrations/     # SQL migration files
│   └── package.json
│
├── training/                    # Python ML training
│   ├── worker.py               # RabbitMQ training job consumer
│   ├── model.py                # DoodleNet CNN architecture
│   ├── preprocess.py           # Stroke to image conversion
│   └── requirements.txt
│
├── docker-compose.yml          # PostgreSQL, MinIO, RabbitMQ
├── architecture.md             # System design documentation
├── claude.md                   # LLM collaboration notes
└── README.md
```

## API Reference

### Collection Service (Port 3001)

```
GET  /api/shapes                  # List available shapes
POST /api/drawings                # Submit a drawing
GET  /api/user/stats              # User's drawing count
```

### Admin Service (Port 3002)

```
GET  /api/admin/stats             # Dashboard statistics
GET  /api/admin/drawings          # Paginated drawing list
POST /api/admin/drawings/:id/flag # Flag drawing
POST /api/admin/training/start    # Start training job
GET  /api/admin/training/:id      # Training job status
GET  /api/admin/models            # List models
POST /api/admin/models/:id/activate
```

### Inference Service (Port 3003)

```
POST /api/inference/classify      # Classify a drawing
GET  /api/inference/model/info    # Current model info
```

## Drawing Data Format

Drawings are stored as stroke data (JSON):

```json
{
  "shape": "circle",
  "canvas": { "width": 400, "height": 400 },
  "strokes": [
    {
      "points": [
        { "x": 100, "y": 100, "pressure": 0.5, "timestamp": 1234567890 }
      ],
      "color": "#000000",
      "width": 3
    }
  ],
  "duration_ms": 2500,
  "device": "mouse"
}
```

## Testing the Application

### Manual Testing Flow

1. **Draw some shapes** - Go to http://localhost:5173 and draw 10+ shapes
2. **Check Admin Dashboard** - Go to http://localhost:5173/#admin to see statistics
3. **Start Training** - Click "Start Training" in the Training tab (requires training worker running)
4. **Test Model** - Go to http://localhost:5173/#implement to test classification

### Run Linting

```bash
# Backend
cd backend && npm run lint

# Frontend
cd frontend && npm run lint && npm run type-check
```

## Development Notes

### Drawing Canvas

The canvas component captures:
- Mouse events (mousedown, mousemove, mouseup)
- Touch events (touchstart, touchmove, touchend)
- Pointer events (for pressure sensitivity)

### Model Training

The training worker:
1. Polls RabbitMQ for training jobs
2. Fetches stroke data from MinIO
3. Converts strokes to 64x64 grayscale images
4. Trains a small CNN (MobileNet-style)
5. Saves model to MinIO, metrics to PostgreSQL

### Local MinIO Setup

Access MinIO console at http://localhost:9001
- Username: minioadmin
- Password: minioadmin

Create buckets:
- `drawings` - Raw stroke data
- `models` - Trained model files

## Key Design Decisions

See [architecture.md](./architecture.md) for detailed system design documentation.

**Highlights:**
- Stroke data stored as JSON (not images) to preserve temporal/pressure info
- Submit-on-completion (not real-time streaming) for simplicity
- MinIO for S3-compatible local object storage
- RabbitMQ for training job queue
- Small CNN optimized for fast inference
