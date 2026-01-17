# Design Apple Maps - Architecture

## System Overview

Apple Maps is a navigation platform with real-time traffic and routing. Core challenges involve route computation, traffic processing, and map data management.

**Learning Goals:**
- Build graph-based routing algorithms
- Design real-time traffic aggregation
- Implement tile-based map serving
- Handle GPS data at scale

---

## Requirements

### Functional Requirements

1. **Route**: Calculate routes between points
2. **Navigate**: Turn-by-turn directions
3. **Traffic**: Show real-time traffic conditions
4. **Search**: Find places and addresses
5. **Offline**: Download maps for offline use

### Non-Functional Requirements

- **Latency**: < 500ms for route calculation
- **Accuracy**: ETA within 10% of actual
- **Scale**: Millions of concurrent navigators
- **Coverage**: Global map data

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client Layer                                │
│          iPhone │ CarPlay │ Apple Watch │ Mac                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway                                  │
│               (Auth, Rate Limiting, CDN)                        │
└─────────────────────────────────────────────────────────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Routing Service│    │Traffic Service│    │  Map Service  │
│               │    │               │    │               │
│ - Pathfinding │    │ - Aggregation │    │ - Tiles       │
│ - ETA         │    │ - Incidents   │    │ - Search      │
│ - Alternatives│    │ - Prediction  │    │ - Geocoding   │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                 │
├─────────────────┬───────────────────┬───────────────────────────┤
│   Graph DB      │   Time-series     │      PostgreSQL + S3      │
│   - Road graph  │   - Traffic flow  │      - POI data           │
│   - Hierarchy   │   - GPS traces    │      - Map tiles          │
└─────────────────┴───────────────────┴───────────────────────────┘
```

---

## Core Components

### 1. Routing Engine

**Graph-Based Pathfinding:**
```javascript
class RoutingEngine {
  constructor(graph) {
    this.graph = graph // Road network graph
    this.trafficService = new TrafficService()
  }

  async findRoute(origin, destination, options = {}) {
    const { avoidTolls, avoidHighways, departureTime } = options

    // Get current traffic conditions
    const trafficData = await this.trafficService.getTraffic(
      this.getBoundingBox(origin, destination)
    )

    // Apply traffic to edge weights
    const weightedGraph = this.applyTrafficWeights(this.graph, trafficData)

    // Run A* with hierarchical decomposition
    const route = await this.aStarHierarchical(
      origin,
      destination,
      weightedGraph,
      { avoidTolls, avoidHighways }
    )

    // Calculate ETA
    const eta = this.calculateETA(route, trafficData, departureTime)

    // Find alternative routes
    const alternatives = await this.findAlternatives(
      origin,
      destination,
      route,
      weightedGraph
    )

    return {
      route,
      eta,
      distance: this.calculateDistance(route),
      alternatives
    }
  }

  async aStarHierarchical(origin, destination, graph, constraints) {
    // Use Contraction Hierarchies for speed
    // Precomputed shortcut edges allow skipping intermediate nodes

    const openSet = new PriorityQueue()
    const cameFrom = new Map()
    const gScore = new Map()
    const fScore = new Map()

    const start = this.findNearestNode(origin)
    const goal = this.findNearestNode(destination)

    gScore.set(start, 0)
    fScore.set(start, this.heuristic(start, goal))
    openSet.enqueue(start, fScore.get(start))

    while (!openSet.isEmpty()) {
      const current = openSet.dequeue()

      if (current === goal) {
        return this.reconstructPath(cameFrom, current)
      }

      // Get edges (including hierarchical shortcuts)
      const edges = graph.getEdges(current)

      for (const edge of edges) {
        // Apply constraints
        if (constraints.avoidTolls && edge.isToll) continue
        if (constraints.avoidHighways && edge.isHighway) continue

        const tentativeG = gScore.get(current) + edge.weight

        if (tentativeG < (gScore.get(edge.target) || Infinity)) {
          cameFrom.set(edge.target, { node: current, edge })
          gScore.set(edge.target, tentativeG)
          fScore.set(edge.target, tentativeG + this.heuristic(edge.target, goal))

          openSet.enqueue(edge.target, fScore.get(edge.target))
        }
      }
    }

    return null // No route found
  }

  async findAlternatives(origin, destination, primaryRoute, graph) {
    // Penalty method: penalize edges in primary route
    const penalizedGraph = this.penalizeEdges(graph, primaryRoute)

    const alt1 = await this.aStarHierarchical(origin, destination, penalizedGraph, {})

    // Further penalize for second alternative
    const penalizedGraph2 = this.penalizeEdges(penalizedGraph, alt1)
    const alt2 = await this.aStarHierarchical(origin, destination, penalizedGraph2, {})

    return [alt1, alt2].filter(r => r && this.isDifferentEnough(r, primaryRoute))
  }
}
```

### 2. Traffic Service

**Real-Time Traffic Aggregation:**
```javascript
class TrafficService {
  constructor() {
    this.segmentFlow = new Map() // segmentId -> { speed, confidence }
    this.incidents = new Map() // location -> incident
  }

  async processGPSProbe(probe) {
    const { deviceId, latitude, longitude, speed, heading, timestamp } = probe

    // Map-match to road segment
    const segment = await this.mapMatch(latitude, longitude, heading)
    if (!segment) return

    // Update segment flow (exponential moving average)
    const current = this.segmentFlow.get(segment.id) || { speed: segment.freeFlowSpeed, samples: 0 }

    const alpha = 0.1 // Smoothing factor
    const newSpeed = alpha * speed + (1 - alpha) * current.speed

    this.segmentFlow.set(segment.id, {
      speed: newSpeed,
      samples: current.samples + 1,
      lastUpdate: timestamp
    })

    // Detect anomalies (possible incident)
    if (speed < segment.freeFlowSpeed * 0.3 && current.samples > 10) {
      await this.detectIncident(segment, probe)
    }
  }

  async getTraffic(boundingBox) {
    const segments = await this.getSegmentsInBounds(boundingBox)

    return segments.map(segment => {
      const flow = this.segmentFlow.get(segment.id)

      if (!flow || this.isStale(flow.lastUpdate)) {
        // Use historical/predicted traffic
        return {
          segmentId: segment.id,
          speed: this.getHistoricalSpeed(segment.id),
          confidence: 'low'
        }
      }

      return {
        segmentId: segment.id,
        speed: flow.speed,
        congestionLevel: this.calculateCongestion(flow.speed, segment.freeFlowSpeed),
        confidence: flow.samples > 5 ? 'high' : 'medium'
      }
    })
  }

  calculateCongestion(currentSpeed, freeFlowSpeed) {
    const ratio = currentSpeed / freeFlowSpeed

    if (ratio > 0.8) return 'free'
    if (ratio > 0.5) return 'light'
    if (ratio > 0.25) return 'moderate'
    return 'heavy'
  }

  async detectIncident(segment, probe) {
    // Aggregate reports from multiple devices
    const recentProbes = await this.getRecentProbes(segment.id, 5) // Last 5 minutes

    const slowCount = recentProbes.filter(p =>
      p.speed < segment.freeFlowSpeed * 0.3
    ).length

    if (slowCount > 5) {
      // Likely incident
      const incident = {
        id: uuid(),
        segmentId: segment.id,
        type: 'congestion',
        severity: 'moderate',
        location: { lat: probe.latitude, lon: probe.longitude },
        reportedAt: Date.now()
      }

      await this.publishIncident(incident)
    }
  }
}
```

### 3. Map Tile Service

**Vector Tile Generation:**
```javascript
class TileService {
  constructor() {
    this.tileCache = new LRUCache({ max: 10000 })
  }

  async getTile(z, x, y, style) {
    const cacheKey = `${z}/${x}/${y}/${style}`

    // Check cache
    const cached = this.tileCache.get(cacheKey)
    if (cached) return cached

    // Generate tile
    const tile = await this.generateTile(z, x, y, style)

    // Cache
    this.tileCache.set(cacheKey, tile)

    return tile
  }

  async generateTile(z, x, y, style) {
    const bounds = this.tileToBounds(z, x, y)

    // Query features in bounds at appropriate zoom
    const features = await this.queryFeatures(bounds, z)

    // Convert to vector tile format (MVT)
    const tile = {
      layers: {}
    }

    // Roads layer
    tile.layers.roads = features
      .filter(f => f.type === 'road')
      .map(f => this.simplify(f, z))

    // Buildings layer (only at high zoom)
    if (z >= 15) {
      tile.layers.buildings = features.filter(f => f.type === 'building')
    }

    // Labels
    tile.layers.labels = this.generateLabels(features, z)

    // POIs
    if (z >= 14) {
      tile.layers.pois = features.filter(f => f.type === 'poi')
    }

    // Encode as protobuf
    return this.encodeAsMVT(tile)
  }

  simplify(feature, zoom) {
    // Douglas-Peucker simplification based on zoom
    const tolerance = 1 / Math.pow(2, zoom)
    return {
      ...feature,
      geometry: simplify(feature.geometry, tolerance)
    }
  }
}
```

### 4. Turn-by-Turn Navigation

**Maneuver Generation:**
```javascript
class NavigationService {
  generateManeuvers(route) {
    const maneuvers = []
    let cumulativeDistance = 0

    for (let i = 0; i < route.edges.length; i++) {
      const edge = route.edges[i]
      const nextEdge = route.edges[i + 1]

      cumulativeDistance += edge.distance

      if (nextEdge) {
        const turnAngle = this.calculateTurnAngle(edge, nextEdge)
        const turnType = this.classifyTurn(turnAngle)

        if (turnType !== 'straight') {
          maneuvers.push({
            type: turnType,
            instruction: this.generateInstruction(edge, nextEdge, turnType),
            distance: cumulativeDistance,
            location: edge.endPoint,
            streetName: nextEdge.streetName
          })

          cumulativeDistance = 0
        }
      } else {
        // Final destination
        maneuvers.push({
          type: 'arrive',
          instruction: 'You have arrived at your destination',
          distance: cumulativeDistance,
          location: edge.endPoint
        })
      }
    }

    return maneuvers
  }

  classifyTurn(angle) {
    // Angle in degrees, positive = right, negative = left
    const absAngle = Math.abs(angle)

    if (absAngle < 15) return 'straight'
    if (absAngle < 45) return angle > 0 ? 'slight-right' : 'slight-left'
    if (absAngle < 120) return angle > 0 ? 'right' : 'left'
    if (absAngle < 160) return angle > 0 ? 'sharp-right' : 'sharp-left'
    return 'u-turn'
  }

  generateInstruction(currentEdge, nextEdge, turnType) {
    const turnPhrase = {
      'slight-right': 'Keep right onto',
      'slight-left': 'Keep left onto',
      'right': 'Turn right onto',
      'left': 'Turn left onto',
      'sharp-right': 'Turn sharp right onto',
      'sharp-left': 'Turn sharp left onto',
      'u-turn': 'Make a U-turn onto'
    }

    return `${turnPhrase[turnType]} ${nextEdge.streetName}`
  }

  // Real-time position tracking
  async trackPosition(userId, position, activeRoute) {
    // Map-match current position
    const matched = await this.mapMatch(position)

    // Check if on route
    const routeProgress = this.calculateRouteProgress(matched, activeRoute)

    if (!routeProgress.onRoute) {
      // Off route - trigger reroute
      return {
        action: 'reroute',
        currentPosition: matched
      }
    }

    // Get next maneuver
    const nextManeuver = this.getNextManeuver(routeProgress, activeRoute.maneuvers)

    // Update ETA based on current progress
    const updatedETA = this.updateETA(routeProgress, activeRoute)

    return {
      action: 'continue',
      nextManeuver,
      distanceToNext: routeProgress.distanceToNextManeuver,
      eta: updatedETA,
      currentStreet: matched.streetName
    }
  }
}
```

---

## Database Schema

This section provides comprehensive documentation of the PostgreSQL database schema with PostGIS extensions for geospatial functionality.

### Entity-Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              APPLE MAPS DATABASE SCHEMA                                          │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

                                    ROAD NETWORK GRAPH
    ┌─────────────────────────────────────────────────────────────────────────┐
    │                                                                         │
    │   ┌──────────────────┐          ┌──────────────────────┐                │
    │   │   road_nodes     │          │   road_segments      │                │
    │   ├──────────────────┤          ├──────────────────────┤                │
    │   │ PK id            │◄─────────┤ FK start_node_id     │                │
    │   │    location      │◄─────────┤ FK end_node_id       │                │
    │   │    lat           │          │ PK id                │                │
    │   │    lng           │          │    geometry          │                │
    │   │    is_intersection│         │    street_name       │                │
    │   └──────────────────┘          │    road_class        │                │
    │                                 │    length_meters     │                │
    │                                 │    free_flow_speed_kph│               │
    │                                 │    is_toll           │                │
    │                                 │    is_one_way        │                │
    │                                 │    turn_restrictions │                │
    │                                 └──────────────────────┘                │
    │                                          │                              │
    └──────────────────────────────────────────┼──────────────────────────────┘
                                               │
               ┌───────────────────────────────┼───────────────────────────────┐
               │                               │                               │
               ▼                               ▼                               │
    ┌──────────────────────┐        ┌──────────────────────┐                   │
    │   traffic_flow       │        │   incidents          │                   │
    ├──────────────────────┤        ├──────────────────────┤                   │
    │ PK id                │        │ PK id (UUID)         │                   │
    │ FK segment_id        │        │ FK segment_id        │                   │
    │    timestamp         │        │    type              │                   │
    │    speed_kph         │        │    severity          │                   │
    │    congestion_level  │        │    location          │                   │
    │    sample_count      │        │    lat               │                   │
    └──────────────────────┘        │    lng               │                   │
                                    │    description       │                   │
                                    │    reported_at       │                   │
                                    │    resolved_at       │                   │
                                    │    is_active         │                   │
                                    └──────────────────────┘                   │
                                                                               │
                                                                               │
    ┌──────────────────────┐        ┌──────────────────────┐                   │
    │   pois               │        │ navigation_sessions  │                   │
    ├──────────────────────┤        ├──────────────────────┤                   │
    │ PK id (UUID)         │        │ PK id (UUID)         │                   │
    │    name              │        │    user_id           │                   │
    │    category          │        │    origin_lat        │                   │
    │    location          │        │    origin_lng        │                   │
    │    lat               │        │    destination_lat   │                   │
    │    lng               │        │    destination_lng   │                   │
    │    address           │        │    route_data (JSONB)│                   │
    │    phone             │        │    started_at        │                   │
    │    hours (JSONB)     │        │    completed_at      │                   │
    │    rating            │        │    status            │                   │
    │    review_count      │        └──────────────────────┘                   │
    └──────────────────────┘                                                   │
                                                                               │
    ─────────────────────────────────────────────────────────────────────────────
    LEGEND:
    PK = Primary Key    FK = Foreign Key    ──────► = References (FK relationship)
    ─────────────────────────────────────────────────────────────────────────────
```

### Table Definitions

#### 1. road_nodes (Graph Vertices)

Represents intersection points and road endpoints in the navigation graph.

```sql
CREATE TABLE road_nodes (
  id BIGSERIAL PRIMARY KEY,
  location GEOGRAPHY(Point, 4326) NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  is_intersection BOOLEAN DEFAULT FALSE
);
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | PRIMARY KEY | Auto-incrementing unique identifier for each node |
| `location` | GEOGRAPHY(Point, 4326) | NOT NULL | PostGIS geography point using WGS84 coordinate system (SRID 4326) for accurate distance calculations |
| `lat` | DOUBLE PRECISION | NOT NULL | Latitude in decimal degrees (-90 to 90); duplicated from location for quick access without PostGIS function calls |
| `lng` | DOUBLE PRECISION | NOT NULL | Longitude in decimal degrees (-180 to 180); duplicated from location for quick access |
| `is_intersection` | BOOLEAN | DEFAULT FALSE | True if this node represents an intersection of 2+ roads; used for maneuver generation |

**Indexes:**
| Index Name | Columns/Type | Purpose |
|------------|--------------|---------|
| `idx_nodes_location` | GIST(location) | Enables fast spatial queries like "find nearest node to GPS point" |
| `idx_nodes_lat_lng` | B-tree(lat, lng) | Supports bounding box queries without PostGIS overhead |

---

#### 2. road_segments (Graph Edges)

Represents road segments connecting nodes with routing metadata.

```sql
CREATE TABLE road_segments (
  id BIGSERIAL PRIMARY KEY,
  start_node_id BIGINT NOT NULL REFERENCES road_nodes(id),
  end_node_id BIGINT NOT NULL REFERENCES road_nodes(id),
  geometry GEOGRAPHY(LineString, 4326) NOT NULL,
  street_name VARCHAR(200),
  road_class VARCHAR(50),
  length_meters DOUBLE PRECISION,
  free_flow_speed_kph INTEGER DEFAULT 50,
  is_toll BOOLEAN DEFAULT FALSE,
  is_one_way BOOLEAN DEFAULT FALSE,
  turn_restrictions JSONB DEFAULT '[]'
);
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | PRIMARY KEY | Auto-incrementing unique identifier for each segment |
| `start_node_id` | BIGINT | NOT NULL, FK road_nodes(id) | Starting node of this directed edge |
| `end_node_id` | BIGINT | NOT NULL, FK road_nodes(id) | Ending node of this directed edge |
| `geometry` | GEOGRAPHY(LineString, 4326) | NOT NULL | Full polyline geometry for map rendering; may have intermediate points even if start/end are direct |
| `street_name` | VARCHAR(200) | NULL | Human-readable street name for navigation instructions (e.g., "Main Street") |
| `road_class` | VARCHAR(50) | NULL | Road type classification: 'highway', 'arterial', 'collector', 'local', 'residential' |
| `length_meters` | DOUBLE PRECISION | NULL | Pre-calculated segment length for routing; derived from geometry |
| `free_flow_speed_kph` | INTEGER | DEFAULT 50 | Speed limit or typical speed without traffic (km/h); used for ETA when no live traffic |
| `is_toll` | BOOLEAN | DEFAULT FALSE | True if segment requires toll payment; supports "avoid tolls" routing option |
| `is_one_way` | BOOLEAN | DEFAULT FALSE | True for one-way streets; affects graph traversal direction |
| `turn_restrictions` | JSONB | DEFAULT '[]' | Array of restricted turns from this segment (e.g., no left turn onto specific streets) |

**Indexes:**
| Index Name | Columns/Type | Purpose |
|------------|--------------|---------|
| `idx_segments_nodes` | B-tree(start_node_id, end_node_id) | Composite index for fast edge lookups by both endpoints |
| `idx_segments_geo` | GIST(geometry) | Spatial index for map-matching GPS points to road segments |
| `idx_segments_start` | B-tree(start_node_id) | Single-column index for graph traversal (get all outgoing edges) |
| `idx_segments_end` | B-tree(end_node_id) | Single-column index for reverse graph traversal (bidirectional A*) |

---

#### 3. traffic_flow (Time-Series Traffic Data)

Stores real-time and historical traffic conditions per road segment.

```sql
CREATE TABLE traffic_flow (
  id BIGSERIAL PRIMARY KEY,
  segment_id BIGINT REFERENCES road_segments(id),
  timestamp TIMESTAMP DEFAULT NOW(),
  speed_kph DOUBLE PRECISION,
  congestion_level VARCHAR(20),
  sample_count INTEGER DEFAULT 1
);
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | PRIMARY KEY | Auto-incrementing unique identifier |
| `segment_id` | BIGINT | FK road_segments(id) | Road segment this traffic data applies to |
| `timestamp` | TIMESTAMP | DEFAULT NOW() | When this traffic observation was recorded; truncated to minute for aggregation |
| `speed_kph` | DOUBLE PRECISION | NULL | Observed average speed on segment (km/h); derived from GPS probe aggregation |
| `congestion_level` | VARCHAR(20) | NULL | Categorical congestion: 'free' (>80%), 'light' (50-80%), 'moderate' (25-50%), 'heavy' (<25% of free flow) |
| `sample_count` | INTEGER | DEFAULT 1 | Number of GPS probes aggregated into this reading; higher = more confidence |

**Indexes:**
| Index Name | Columns/Type | Purpose |
|------------|--------------|---------|
| `idx_traffic_segment` | B-tree(segment_id) | Fast lookup of traffic for a specific road segment |
| `idx_traffic_timestamp` | B-tree(timestamp) | Enables time-range queries for historical traffic patterns |

---

#### 4. incidents (Traffic Incidents)

Tracks accidents, construction, closures, and other road events.

```sql
CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id BIGINT REFERENCES road_segments(id),
  type VARCHAR(50),
  severity VARCHAR(20),
  location GEOGRAPHY(Point, 4326),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  description TEXT,
  reported_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE
);
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | UUID for globally unique incident identification across distributed systems |
| `segment_id` | BIGINT | FK road_segments(id) | Road segment affected; NULL if incident is point-based only |
| `type` | VARCHAR(50) | NULL | Incident category: 'accident', 'construction', 'closure', 'hazard', 'weather' |
| `severity` | VARCHAR(20) | NULL | Impact level: 'low' (minor delay), 'moderate' (significant delay), 'high' (road blocked) |
| `location` | GEOGRAPHY(Point, 4326) | NULL | Precise incident location for map display and proximity queries |
| `lat` | DOUBLE PRECISION | NULL | Latitude; duplicated from location for quick access |
| `lng` | DOUBLE PRECISION | NULL | Longitude; duplicated from location for quick access |
| `description` | TEXT | NULL | Human-readable incident details from reports or official sources |
| `reported_at` | TIMESTAMP | DEFAULT NOW() | When incident was first reported; used for staleness detection |
| `resolved_at` | TIMESTAMP | NULL | When incident was cleared; NULL while active |
| `is_active` | BOOLEAN | DEFAULT TRUE | False after resolution; allows query of only active incidents |

**Indexes:**
| Index Name | Columns/Type | Purpose |
|------------|--------------|---------|
| `idx_incidents_location` | GIST(location) | Spatial queries: "incidents within X meters of route" |
| `idx_incidents_active` | B-tree(is_active) WHERE is_active = TRUE | Partial index for fast active-only queries; excludes resolved incidents |

---

#### 5. pois (Points of Interest)

Stores searchable locations like businesses, landmarks, and addresses.

```sql
CREATE TABLE pois (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  location GEOGRAPHY(Point, 4326) NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  address TEXT,
  phone VARCHAR(50),
  hours JSONB,
  rating DOUBLE PRECISION,
  review_count INTEGER DEFAULT 0
);
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | UUID for stable external references and API responses |
| `name` | VARCHAR(200) | NOT NULL | Business or location name; indexed for full-text search |
| `category` | VARCHAR(100) | NULL | POI type: 'restaurant', 'gas_station', 'hospital', 'parking', 'hotel', etc. |
| `location` | GEOGRAPHY(Point, 4326) | NOT NULL | Geographic coordinates for map display and routing destination |
| `lat` | DOUBLE PRECISION | NOT NULL | Latitude; duplicated for non-spatial queries |
| `lng` | DOUBLE PRECISION | NOT NULL | Longitude; duplicated for non-spatial queries |
| `address` | TEXT | NULL | Formatted street address for display |
| `phone` | VARCHAR(50) | NULL | Contact phone number |
| `hours` | JSONB | NULL | Operating hours in structured format: {"monday": {"open": "09:00", "close": "17:00"}, ...} |
| `rating` | DOUBLE PRECISION | NULL | Average user rating (typically 0-5 scale) |
| `review_count` | INTEGER | DEFAULT 0 | Number of reviews; used for relevance ranking |

**Indexes:**
| Index Name | Columns/Type | Purpose |
|------------|--------------|---------|
| `idx_pois_location` | GIST(location) | "Find POIs near me" queries with ST_DWithin |
| `idx_pois_category` | B-tree(category) | Filter by category: "gas stations near me" |
| `idx_pois_name` | GIN(to_tsvector('english', name)) | Full-text search on POI names |

---

#### 6. navigation_sessions (Active Navigation Tracking)

Tracks user navigation sessions for real-time updates and analytics.

```sql
CREATE TABLE navigation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100),
  origin_lat DOUBLE PRECISION,
  origin_lng DOUBLE PRECISION,
  destination_lat DOUBLE PRECISION,
  destination_lng DOUBLE PRECISION,
  route_data JSONB,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active'
);
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Session identifier sent to client for updates |
| `user_id` | VARCHAR(100) | NULL | Anonymous or authenticated user identifier; NULL for guest users |
| `origin_lat` | DOUBLE PRECISION | NULL | Starting point latitude |
| `origin_lng` | DOUBLE PRECISION | NULL | Starting point longitude |
| `destination_lat` | DOUBLE PRECISION | NULL | Destination latitude |
| `destination_lng` | DOUBLE PRECISION | NULL | Destination longitude |
| `route_data` | JSONB | NULL | Full route including polyline, maneuvers, ETA; updated on reroute |
| `started_at` | TIMESTAMP | DEFAULT NOW() | Session creation time |
| `completed_at` | TIMESTAMP | NULL | When user arrived or cancelled; NULL while active |
| `status` | VARCHAR(20) | DEFAULT 'active' | Session state: 'active', 'completed', 'cancelled' |

**Indexes:**
| Index Name | Columns/Type | Purpose |
|------------|--------------|---------|
| `idx_nav_sessions_user` | B-tree(user_id) | Lookup user's active/recent sessions |
| `idx_nav_sessions_status` | B-tree(status) | Filter for active sessions only |

---

### Foreign Key Relationships

| Child Table | Column | Parent Table | Column | ON DELETE | ON UPDATE | Rationale |
|-------------|--------|--------------|--------|-----------|-----------|-----------|
| `road_segments` | `start_node_id` | `road_nodes` | `id` | NO ACTION | NO ACTION | Segments cannot exist without valid nodes; deletion requires explicit cleanup to maintain graph integrity |
| `road_segments` | `end_node_id` | `road_nodes` | `id` | NO ACTION | NO ACTION | Same as above; prevents orphaned edges |
| `traffic_flow` | `segment_id` | `road_segments` | `id` | NO ACTION | NO ACTION | Historical traffic data should be preserved; segment deletion is rare administrative action |
| `incidents` | `segment_id` | `road_segments` | `id` | SET NULL | NO ACTION | Incidents can exist as point locations even if road data is updated; preserves incident history |

**Why NO ACTION instead of CASCADE:**

1. **Graph Integrity**: The road network is a graph where nodes and segments are deeply interconnected. Cascading deletes could accidentally remove large portions of the road network from a single delete operation.

2. **Data Pipeline Safety**: Map data is typically bulk-imported/updated. Using NO ACTION forces explicit transaction management and prevents accidental data loss during ETL processes.

3. **Audit Trail**: Traffic and incident data represents historical records. Even if road geometry changes, keeping historical data helps with analytics and debugging.

4. **Incidents SET NULL**: An incident's location (lat/lng) is the primary reference. If a road segment is restructured, the incident remains valid at its geographic point.

---

### Why Tables Are Structured This Way

#### 1. Dual Coordinate Storage (lat/lng + GEOGRAPHY)

Both `road_nodes` and `pois` store coordinates twice: as separate `lat`/`lng` columns AND as a PostGIS `GEOGRAPHY` column.

**Rationale:**
- **GEOGRAPHY columns** are required for accurate distance calculations (ST_Distance) and spatial indexing (GIST)
- **Separate lat/lng columns** allow:
  - Fast bounding box queries without PostGIS: `WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`
  - Direct JSON serialization without PostGIS function calls
  - Simpler client-side processing
- **Trade-off**: Minor storage overhead (~16 bytes per row) is acceptable given read frequency

#### 2. BIGSERIAL for Graph IDs, UUID for User-Facing Entities

- **road_nodes, road_segments, traffic_flow**: Use `BIGSERIAL` because:
  - Graph algorithms need dense, sequential IDs for array indexing
  - Routing graph is loaded into memory with node IDs as array indices
  - Sequential IDs enable efficient gap-free iteration

- **pois, incidents, navigation_sessions**: Use `UUID` because:
  - Exposed in API responses (no sequential ID enumeration attack)
  - Supports distributed ID generation without coordination
  - Stable references across database migrations or sharding

#### 3. JSONB for Flexible Structured Data

Three columns use JSONB: `turn_restrictions`, `hours`, `route_data`

**turn_restrictions (road_segments):**
```json
[
  {"via": 12345, "to": 67890, "restriction": "no_left_turn"},
  {"to": 11111, "restriction": "no_u_turn"}
]
```
- Complex relationship data that varies per segment
- Array of restrictions; would require junction table otherwise
- Rarely queried directly; loaded with segment data

**hours (pois):**
```json
{
  "monday": {"open": "09:00", "close": "17:00"},
  "tuesday": {"open": "09:00", "close": "17:00"},
  "special": [{"date": "2024-12-25", "closed": true}]
}
```
- Highly variable structure (24/7, seasonal, special hours)
- Display-only data; not used for filtering

**route_data (navigation_sessions):**
```json
{
  "polyline": "encoded_polyline_string",
  "distance_meters": 15000,
  "duration_seconds": 1200,
  "maneuvers": [...],
  "traffic_delay_seconds": 300
}
```
- Opaque blob for client consumption
- Version-independent serialization
- No need to query internal fields

#### 4. Denormalized congestion_level in traffic_flow

`congestion_level` ('free', 'light', 'moderate', 'heavy') can be derived from `speed_kph` and segment's `free_flow_speed_kph`.

**Why store it:**
- Avoids JOIN with road_segments on every traffic query
- Pre-computed during probe aggregation (write-time calculation)
- Enables simple queries: `WHERE congestion_level = 'heavy'`
- Trade-off: ~20 bytes per row, saves JOIN on high-frequency reads

#### 5. Partial Index for Active Incidents

```sql
CREATE INDEX idx_incidents_active ON incidents(is_active) WHERE is_active = TRUE;
```

**Rationale:**
- 99% of queries filter for `is_active = TRUE`
- Historical incidents (resolved) are rarely queried
- Partial index is ~10-50x smaller than full index
- Resolving an incident (setting `is_active = FALSE`) automatically removes it from index

---

### Data Flow for Key Operations

#### 1. Route Calculation

**Query: Find path from origin to destination**

```sql
-- Step 1: Find nearest node to origin point
SELECT id, lat, lng,
       ST_Distance(location, ST_MakePoint($lng, $lat)::geography) as dist
FROM road_nodes
ORDER BY location <-> ST_MakePoint($lng, $lat)::geography
LIMIT 1;

-- Step 2: Find nearest node to destination
SELECT id, lat, lng,
       ST_Distance(location, ST_MakePoint($dest_lng, $dest_lat)::geography) as dist
FROM road_nodes
ORDER BY location <-> ST_MakePoint($dest_lng, $dest_lat)::geography
LIMIT 1;

-- Step 3: Load graph edges (typically cached in memory)
SELECT
    rs.id,
    rs.start_node_id,
    rs.end_node_id,
    rs.length_meters,
    rs.free_flow_speed_kph,
    rs.is_toll,
    rs.is_one_way,
    rs.street_name,
    COALESCE(tf.speed_kph, rs.free_flow_speed_kph) as current_speed_kph
FROM road_segments rs
LEFT JOIN LATERAL (
    SELECT speed_kph
    FROM traffic_flow
    WHERE segment_id = rs.id
    ORDER BY timestamp DESC
    LIMIT 1
) tf ON true
WHERE rs.start_node_id = ANY($node_ids) OR rs.end_node_id = ANY($node_ids);

-- Step 4: Check for incidents on potential route segments
SELECT segment_id, type, severity, description
FROM incidents
WHERE segment_id = ANY($route_segment_ids)
  AND is_active = TRUE;
```

**Index usage:**
- Step 1-2: Uses `idx_nodes_location` GIST index for KNN query (`<->` operator)
- Step 3: Uses `idx_segments_start` and `idx_segments_end` for edge lookup
- Step 3: Uses `idx_traffic_segment` for latest traffic data
- Step 4: Uses partial index `idx_incidents_active`

---

#### 2. GPS Probe Ingestion (Traffic Update)

**Operation: Process incoming GPS probe and update traffic**

```sql
-- Step 1: Map-match GPS point to road segment
SELECT
    id as segment_id,
    street_name,
    free_flow_speed_kph,
    ST_Distance(geometry, ST_MakePoint($lng, $lat)::geography) as distance_meters
FROM road_segments
WHERE ST_DWithin(geometry, ST_MakePoint($lng, $lat)::geography, 50)  -- 50m threshold
ORDER BY geometry <-> ST_MakePoint($lng, $lat)::geography
LIMIT 1;

-- Step 2: Upsert traffic flow (idempotent)
INSERT INTO traffic_flow (segment_id, timestamp, speed_kph, congestion_level, sample_count)
VALUES (
    $segment_id,
    date_trunc('minute', $timestamp),
    $speed_kph,
    CASE
        WHEN $speed_kph > $free_flow * 0.8 THEN 'free'
        WHEN $speed_kph > $free_flow * 0.5 THEN 'light'
        WHEN $speed_kph > $free_flow * 0.25 THEN 'moderate'
        ELSE 'heavy'
    END,
    1
)
ON CONFLICT (segment_id, timestamp) DO UPDATE SET
    speed_kph = (traffic_flow.speed_kph * traffic_flow.sample_count + EXCLUDED.speed_kph)
                / (traffic_flow.sample_count + 1),
    sample_count = traffic_flow.sample_count + 1,
    congestion_level = CASE
        WHEN (traffic_flow.speed_kph * traffic_flow.sample_count + EXCLUDED.speed_kph)
             / (traffic_flow.sample_count + 1) > $free_flow * 0.8 THEN 'free'
        WHEN (traffic_flow.speed_kph * traffic_flow.sample_count + EXCLUDED.speed_kph)
             / (traffic_flow.sample_count + 1) > $free_flow * 0.5 THEN 'light'
        WHEN (traffic_flow.speed_kph * traffic_flow.sample_count + EXCLUDED.speed_kph)
             / (traffic_flow.sample_count + 1) > $free_flow * 0.25 THEN 'moderate'
        ELSE 'heavy'
    END;
```

**Note:** The current schema uses `id` as PRIMARY KEY, not `(segment_id, timestamp)`. For true idempotent upsert, consider adding a unique constraint:

```sql
ALTER TABLE traffic_flow ADD CONSTRAINT uk_traffic_segment_time
    UNIQUE (segment_id, date_trunc('minute', timestamp));
```

---

#### 3. POI Search

**Query: Search for restaurants near current location**

```sql
-- Full-text search with location ranking
SELECT
    id,
    name,
    category,
    address,
    lat,
    lng,
    rating,
    review_count,
    ST_Distance(location, ST_MakePoint($lng, $lat)::geography) as distance_meters
FROM pois
WHERE
    -- Text search
    to_tsvector('english', name) @@ plainto_tsquery('english', $search_query)
    -- Category filter (optional)
    AND ($category IS NULL OR category = $category)
    -- Location filter: within 5km
    AND ST_DWithin(location, ST_MakePoint($lng, $lat)::geography, 5000)
ORDER BY
    -- Rank by combination of distance, rating, and review count
    (ST_Distance(location, ST_MakePoint($lng, $lat)::geography) / 1000.0)  -- km penalty
    - (COALESCE(rating, 0) * 0.5)  -- rating bonus
    - (LOG(GREATEST(review_count, 1)) * 0.2)  -- popularity bonus
LIMIT 20;
```

**Index usage:**
- `idx_pois_name` GIN index for full-text search
- `idx_pois_category` for category filter
- `idx_pois_location` GIST for distance filter and ordering

---

#### 4. Active Incident Query

**Query: Get incidents affecting a route**

```sql
-- Find active incidents within buffer of route polyline
SELECT
    i.id,
    i.type,
    i.severity,
    i.description,
    i.lat,
    i.lng,
    rs.street_name as affected_street,
    ST_Distance(i.location, $route_geometry::geography) as distance_to_route_meters
FROM incidents i
LEFT JOIN road_segments rs ON i.segment_id = rs.id
WHERE
    i.is_active = TRUE
    AND ST_DWithin(i.location, $route_geometry::geography, 500)  -- 500m buffer
ORDER BY
    CASE i.severity
        WHEN 'high' THEN 1
        WHEN 'moderate' THEN 2
        WHEN 'low' THEN 3
    END,
    ST_Distance(i.location, $route_geometry::geography);
```

**Index usage:**
- `idx_incidents_active` partial index (filtered for is_active = TRUE)
- `idx_incidents_location` GIST for spatial distance query

---

### Schema Design Considerations

#### Scalability Patterns

1. **Time-Based Partitioning for traffic_flow**:
   For production scale, partition by timestamp:
   ```sql
   CREATE TABLE traffic_flow (
       ...
   ) PARTITION BY RANGE (timestamp);

   CREATE TABLE traffic_flow_2024_01 PARTITION OF traffic_flow
       FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
   ```

2. **Geographic Sharding for road_nodes/road_segments**:
   Consider H3 or S2 cell-based partitioning for global scale:
   ```sql
   ALTER TABLE road_nodes ADD COLUMN h3_cell VARCHAR(20);
   CREATE INDEX idx_nodes_h3 ON road_nodes(h3_cell);
   ```

3. **Read Replicas for POI Search**:
   POI data is read-heavy; route to read replicas for search queries.

#### Data Retention

| Table | Retention | Strategy |
|-------|-----------|----------|
| road_nodes, road_segments | Permanent | Core graph data |
| traffic_flow | 7 days live + 1 year aggregated | Roll up to hourly after 7 days |
| incidents | 90 days active + archive | Move resolved to cold storage |
| navigation_sessions | 30 days | Delete or anonymize after 30 days |
| pois | Permanent | Soft delete for removed POIs |

---

## Key Design Decisions

### 1. Contraction Hierarchies

**Decision**: Precompute hierarchical shortcuts for routing

**Rationale**:
- Orders of magnitude faster routing
- Can still incorporate real-time traffic
- Trade storage for speed

### 2. GPS Probe Aggregation

**Decision**: Aggregate anonymous GPS probes for traffic

**Rationale**:
- Real-time traffic from actual drivers
- Privacy-preserving (aggregated, not individual)
- Self-updating as road conditions change

### 3. Vector Tiles

**Decision**: Serve vector tiles, not raster

**Rationale**:
- Smaller download size
- Client-side styling
- Rotation without quality loss

---

## Consistency and Idempotency Semantics

### Write Consistency Model

This system uses different consistency levels based on data criticality:

| Data Type | Consistency | Rationale |
|-----------|-------------|-----------|
| Road graph (nodes, segments) | Strong (PostgreSQL transactions) | Infrequent writes, correctness critical |
| Traffic flow | Eventual (last-write-wins) | High write volume, stale data acceptable for seconds |
| Incidents | Eventual with conflict resolution | Multiple sources may report same incident |
| POIs | Strong (PostgreSQL transactions) | User-facing data, consistency matters |
| User saved places | Strong (PostgreSQL transactions) | Must not lose user data |

### Idempotency Implementation

**GPS Probe Ingestion (Idempotent)**:
```javascript
// Each probe has a composite key: deviceId + timestamp
// Duplicate probes are ignored via UPSERT
async function ingestProbe(probe) {
  const idempotencyKey = `${probe.deviceId}:${probe.timestamp}`;

  // Redis check for recent duplicates (24h TTL)
  const exists = await redis.get(`probe:${idempotencyKey}`);
  if (exists) {
    return { status: 'duplicate', processed: false };
  }

  await redis.setex(`probe:${idempotencyKey}`, 86400, '1');
  await processProbe(probe);
  return { status: 'processed', processed: true };
}
```

**Incident Reports (Conflict Resolution)**:
```javascript
// Multiple users may report same incident
// Merge strategy: earliest report wins, aggregate confidence
async function reportIncident(report) {
  const existing = await findNearbyIncident(report.location, 100); // 100m radius

  if (existing) {
    // Merge: increase confidence, update last_seen
    await db.query(`
      UPDATE incidents
      SET confidence = LEAST(confidence + 0.1, 1.0),
          sample_count = sample_count + 1,
          last_reported_at = NOW()
      WHERE id = $1
    `, [existing.id]);
    return { action: 'merged', incidentId: existing.id };
  }

  // New incident with idempotency key
  const idempotencyKey = report.clientRequestId;
  const result = await db.query(`
    INSERT INTO incidents (id, segment_id, location, type, reported_at, idempotency_key)
    VALUES ($1, $2, $3, $4, NOW(), $5)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  `, [uuid(), report.segmentId, report.location, report.type, idempotencyKey]);

  return { action: result.rowCount ? 'created' : 'duplicate' };
}
```

### Replay Handling

For queue-based processing (GPS probes, traffic updates):

1. **At-least-once delivery**: RabbitMQ with manual acknowledgment
2. **Deduplication window**: Redis set with 24h TTL for probe IDs
3. **Idempotent writes**: PostgreSQL UPSERT for traffic_flow table

```sql
-- Traffic flow upsert (idempotent)
INSERT INTO traffic_flow (segment_id, timestamp, speed_kph, sample_count)
VALUES ($1, date_trunc('minute', $2), $3, 1)
ON CONFLICT (segment_id, timestamp) DO UPDATE SET
  speed_kph = (traffic_flow.speed_kph * traffic_flow.sample_count + EXCLUDED.speed_kph)
              / (traffic_flow.sample_count + 1),
  sample_count = traffic_flow.sample_count + 1;
```

---

## Observability

### Metrics (Prometheus Format)

**Routing Service Metrics**:
```prometheus
# Route calculation latency
routing_request_duration_seconds{route_type="primary|alternative"}

# Route success/failure
routing_requests_total{status="success|no_route|error"}

# Graph operations
routing_nodes_visited_total
routing_path_length_meters

# Cache effectiveness
tile_cache_hits_total
tile_cache_misses_total
```

**Traffic Service Metrics**:
```prometheus
# Probe ingestion rate
traffic_probes_ingested_total
traffic_probes_duplicates_total

# Aggregation lag
traffic_segment_staleness_seconds{segment_id}

# Incident detection
traffic_incidents_detected_total{type="congestion|accident|road_work"}
traffic_incidents_false_positives_total
```

**Infrastructure Metrics**:
```prometheus
# Database connections
postgres_connections_active
postgres_query_duration_seconds{query_type}

# Queue depth (RabbitMQ)
rabbitmq_queue_messages{queue="gps_probes"}
rabbitmq_consumers_active

# Redis cache
redis_memory_used_bytes
redis_keyspace_hits_total
redis_keyspace_misses_total
```

### Logging Strategy

**Structured Log Format**:
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "info",
  "service": "routing",
  "trace_id": "abc123",
  "span_id": "def456",
  "user_id": "anonymized-hash",
  "event": "route_calculated",
  "duration_ms": 145,
  "origin_tile": "12/1234/5678",
  "destination_tile": "12/1235/5679",
  "distance_km": 15.3,
  "traffic_delay_minutes": 5
}
```

**Log Levels by Event**:
| Event | Level | Retention |
|-------|-------|-----------|
| Route calculated | INFO | 7 days |
| Route failed (no path) | WARN | 30 days |
| Database error | ERROR | 90 days |
| Incident detected | INFO | 30 days |
| GPS probe ingested | DEBUG | 1 day |

### Distributed Tracing

**Trace Propagation** (OpenTelemetry):
```javascript
// Example trace for route request
async function handleRouteRequest(req, res) {
  const span = tracer.startSpan('route_request', {
    attributes: {
      'http.method': 'POST',
      'route.origin': hashLocation(req.body.origin),
      'route.destination': hashLocation(req.body.destination)
    }
  });

  try {
    // Child span for traffic fetch
    const trafficSpan = tracer.startSpan('fetch_traffic', { parent: span });
    const traffic = await trafficService.getTraffic(bounds);
    trafficSpan.end();

    // Child span for A* execution
    const routingSpan = tracer.startSpan('astar_routing', { parent: span });
    const route = await routingEngine.findRoute(origin, dest, traffic);
    routingSpan.setAttribute('nodes_visited', route.nodesVisited);
    routingSpan.end();

    span.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    throw error;
  } finally {
    span.end();
  }
}
```

### SLI Dashboards

**Primary Dashboard Panels**:

1. **Route Latency (p50, p95, p99)**
   - Target: p95 < 500ms, p99 < 1000ms
   - Alert if p95 > 750ms for 5 minutes

2. **Route Success Rate**
   - Target: > 99.5% successful routes
   - Alert if < 99% for 5 minutes

3. **Traffic Data Freshness**
   - Target: 90% of segments updated within 5 minutes
   - Alert if < 80% fresh for 10 minutes

4. **ETA Accuracy**
   - Compare predicted vs actual arrival times
   - Target: 90% within 10% of actual
   - Weekly review (not alertable)

### Alert Thresholds

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Route p95 latency | > 500ms | > 1000ms | Scale routing workers |
| Route error rate | > 1% | > 5% | Page on-call, check DB |
| Probe ingestion lag | > 1 min | > 5 min | Check RabbitMQ, scale consumers |
| Postgres connections | > 80% | > 95% | Investigate connection leaks |
| Redis memory | > 80% | > 95% | Evict stale keys, add capacity |
| Disk usage (tiles) | > 70% | > 85% | Archive old tiles to S3 |

### Audit Logging

**Auditable Events** (written to separate audit log):
```javascript
const auditLog = {
  // Admin actions
  'map_data.import': { retention: '1 year', pii: false },
  'incident.manual_create': { retention: '1 year', pii: true },
  'incident.manual_resolve': { retention: '1 year', pii: true },
  'poi.create': { retention: '1 year', pii: false },
  'poi.update': { retention: '1 year', pii: false },
  'poi.delete': { retention: '1 year', pii: false },

  // User data access (for compliance)
  'user.saved_places.export': { retention: '2 years', pii: true },
  'user.location_history.access': { retention: '2 years', pii: true }
};

async function audit(event, actor, details) {
  await db.query(`
    INSERT INTO audit_log (event, actor_id, actor_type, details, ip_address, timestamp)
    VALUES ($1, $2, $3, $4, $5, NOW())
  `, [event, actor.id, actor.type, JSON.stringify(details), actor.ip]);
}
```

---

## Failure Handling

### Retry Strategy with Idempotency

**HTTP Client Retries**:
```javascript
const retryConfig = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504]
};

async function fetchWithRetry(url, options, idempotencyKey) {
  let lastError;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'Idempotency-Key': idempotencyKey,
          'X-Request-Attempt': attempt
        }
      });

      if (response.ok) return response;

      if (!retryConfig.retryableStatusCodes.includes(response.status)) {
        throw new Error(`Non-retryable status: ${response.status}`);
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < retryConfig.maxRetries) {
      const delay = Math.min(
        retryConfig.initialDelayMs * Math.pow(retryConfig.backoffMultiplier, attempt),
        retryConfig.maxDelayMs
      );
      await sleep(delay + Math.random() * 100); // Jitter
    }
  }

  throw lastError;
}
```

**Queue Consumer Retries**:
```javascript
// RabbitMQ dead letter queue for failed messages
const queueConfig = {
  queue: 'gps_probes',
  deadLetterExchange: 'gps_probes_dlx',
  maxRetries: 3,
  retryDelays: [1000, 5000, 30000] // 1s, 5s, 30s
};

async function processWithRetry(message) {
  const retryCount = message.properties.headers['x-retry-count'] || 0;

  try {
    await processProbe(JSON.parse(message.content));
    channel.ack(message);
  } catch (error) {
    if (retryCount >= queueConfig.maxRetries) {
      // Send to dead letter queue for manual inspection
      channel.nack(message, false, false);
      await alertSlack(`Probe processing failed after ${retryCount} retries`);
    } else {
      // Requeue with delay
      channel.nack(message, false, false);
      setTimeout(() => {
        channel.publish('', 'gps_probes', message.content, {
          headers: { 'x-retry-count': retryCount + 1 }
        });
      }, queueConfig.retryDelays[retryCount]);
    }
  }
}
```

### Circuit Breaker Pattern

```javascript
class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;

    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 3;
    this.timeout = options.timeout || 30000; // 30s before trying again
  }

  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error(`Circuit breaker ${this.name} is OPEN`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'CLOSED';
        this.successCount = 0;
      }
    }
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }
}

// Usage for external traffic data provider
const externalTrafficBreaker = new CircuitBreaker('external_traffic', {
  failureThreshold: 5,
  timeout: 60000
});

async function getExternalTrafficData(bounds) {
  return externalTrafficBreaker.execute(async () => {
    return await fetch(`https://traffic-provider.com/api/v1/flow?bounds=${bounds}`);
  });
}
```

### Graceful Degradation

```javascript
class RoutingService {
  async findRoute(origin, destination, options) {
    let trafficData;

    // Try real-time traffic, fall back to historical
    try {
      trafficData = await this.trafficBreaker.execute(() =>
        this.trafficService.getTraffic(bounds)
      );
    } catch (error) {
      console.warn('Traffic service unavailable, using historical data');
      trafficData = await this.getHistoricalTraffic(bounds, new Date());
      // Add warning to response
      options.degraded = { traffic: 'historical' };
    }

    // Try primary routing, fall back to simpler algorithm
    try {
      return await this.aStarHierarchical(origin, destination, trafficData);
    } catch (error) {
      if (error.message.includes('timeout')) {
        console.warn('Hierarchical routing timeout, falling back to basic A*');
        options.degraded = { ...options.degraded, routing: 'basic' };
        return await this.basicAStar(origin, destination);
      }
      throw error;
    }
  }
}
```

### Local Development Disaster Recovery

For this learning project, we simulate multi-region patterns locally:

**Backup Strategy**:
```bash
# Automated daily backup (cron job in development)
#!/bin/bash
BACKUP_DIR="./backups/$(date +%Y-%m-%d)"
mkdir -p $BACKUP_DIR

# PostgreSQL backup
pg_dump -h localhost -U maps_user maps_db > "$BACKUP_DIR/maps_db.sql"

# Redis backup (RDB snapshot)
redis-cli BGSAVE
cp /var/lib/redis/dump.rdb "$BACKUP_DIR/redis.rdb"

# Compress and optionally upload to MinIO (S3-compatible)
tar -czf "$BACKUP_DIR.tar.gz" "$BACKUP_DIR"
mc cp "$BACKUP_DIR.tar.gz" minio/backups/

# Retain last 7 days locally
find ./backups -mtime +7 -delete
```

**Restore Testing** (run monthly):
```bash
#!/bin/bash
# Test restore to verify backups are valid

# 1. Start fresh containers
docker-compose -f docker-compose.restore-test.yml up -d

# 2. Restore PostgreSQL
docker exec -i restore_postgres psql -U maps_user maps_db < backups/latest/maps_db.sql

# 3. Restore Redis
docker cp backups/latest/redis.rdb restore_redis:/data/dump.rdb
docker restart restore_redis

# 4. Run smoke tests
npm run test:smoke -- --target=restore

# 5. Cleanup
docker-compose -f docker-compose.restore-test.yml down -v
```

**Simulated Region Failover** (for learning):
```yaml
# docker-compose.multi-region.yml
version: '3.8'
services:
  # Primary region
  routing-primary:
    build: ./backend
    environment:
      - REGION=primary
      - DATABASE_URL=postgres://localhost:5432/maps_primary
    ports:
      - "3001:3000"

  # Secondary region (simulated)
  routing-secondary:
    build: ./backend
    environment:
      - REGION=secondary
      - DATABASE_URL=postgres://localhost:5433/maps_secondary
      - READ_REPLICA=true
    ports:
      - "3002:3000"

  # Load balancer with health checks
  haproxy:
    image: haproxy:latest
    volumes:
      - ./haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg
    ports:
      - "3000:3000"

# haproxy.cfg includes:
# - Health check every 5s
# - Failover to secondary if primary fails 3 checks
# - Sticky sessions for active navigation
```

### Health Checks

```javascript
// Comprehensive health check endpoint
app.get('/health', async (req, res) => {
  const checks = {
    database: await checkPostgres(),
    redis: await checkRedis(),
    rabbitmq: await checkRabbitMQ(),
    routing_graph: await checkRoutingGraph()
  };

  const allHealthy = Object.values(checks).every(c => c.status === 'healthy');

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks
  });
});

async function checkPostgres() {
  const start = Date.now();
  try {
    await db.query('SELECT 1');
    return { status: 'healthy', latency_ms: Date.now() - start };
  } catch (error) {
    return { status: 'unhealthy', error: error.message };
  }
}

async function checkRoutingGraph() {
  // Verify graph is loaded and queryable
  const start = Date.now();
  try {
    const nodeCount = routingEngine.graph.nodeCount();
    if (nodeCount < 100) {
      return { status: 'degraded', message: 'Graph appears incomplete' };
    }
    return { status: 'healthy', nodes: nodeCount, latency_ms: Date.now() - start };
  } catch (error) {
    return { status: 'unhealthy', error: error.message };
  }
}
```

---

## Trade-offs Summary

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Routing | Contraction hierarchies | Plain Dijkstra | Speed |
| Traffic | GPS probe aggregation | Sensor only | Coverage, cost |
| Map format | Vector tiles | Raster | Flexibility, size |
| ETA | ML prediction | Simple calculation | Accuracy |
| Traffic consistency | Eventual (last-write-wins) | Strong consistency | High write throughput |
| Probe deduplication | Redis with TTL | Database unique constraint | Performance at scale |
| Circuit breaker timeout | 30 seconds | Shorter/longer | Balance between recovery and availability |
| Backup frequency | Daily | Hourly | Sufficient for learning project, low data change rate |

---

## Implementation Notes

This section documents the production-ready observability and resilience patterns implemented in the backend codebase.

### Prometheus Metrics (src/shared/metrics.js)

**WHY**: Metrics are the foundation of the RED method (Rate, Errors, Duration) observability:

1. **Route Calculation Latency** (`routing_calculation_duration_seconds`)
   - Histogram with buckets from 50ms to 5s
   - Enables SLI tracking: "p95 route latency < 500ms"
   - Labels by route_type and status for drill-down

2. **HTTP Request Metrics** (`http_request_duration_seconds`, `http_requests_total`)
   - Track every API request's duration and status code
   - Normalized routes prevent cardinality explosion
   - Active request gauge shows concurrent load

3. **Cache Hit Rates** (`cache_hits_total`, `cache_misses_total`)
   - Critical for capacity planning
   - Low hit rate indicates cache misconfiguration
   - Labels by cache_name for targeted optimization

4. **Circuit Breaker State** (`circuit_breaker_state`)
   - Real-time visibility into service health
   - Enables alerts when breakers open
   - Tracks failure/success counts for debugging

**Alert Thresholds**:
```
routing_calculation_duration_seconds{quantile="0.95"} > 0.5 for 5m  -> Warning
routing_requests_total{status="error"} / routing_requests_total > 0.01 for 5m -> Warning
circuit_breaker_state{name="routing_graph_load"} == 1 for 1m -> Critical
```

### Structured Logging with Pino (src/shared/logger.js)

**WHY**: Structured logs enable machine parsing and correlation:

1. **JSON Format**: Every log is a JSON object with consistent fields
   - `timestamp`, `level`, `service`, `message`
   - Additional context fields as needed

2. **Request Correlation**: HTTP middleware adds `requestId` to every log
   - Trace a single request across all log entries
   - Essential for debugging distributed issues

3. **Sensitive Data Redaction**: Automatically removes:
   - Authorization headers
   - Cookies
   - Password fields

4. **Log Levels by Environment**:
   - Production: `info` level, JSON output
   - Development: `debug` level, pretty-printed

5. **Audit Logging**: Separate logger for compliance events
   - Admin actions, data exports, incident management
   - Longer retention, immutable storage

### Circuit Breakers (src/shared/circuitBreaker.js)

**WHY**: Prevent cascading failures when dependencies fail:

1. **Routing Graph Load Breaker**
   - Protects against database overload during graph queries
   - Fallback returns stale cached graph if available
   - Opens after 5 failures, closes after 3 successes

2. **Geocoding Breaker**
   - Isolates geocoding failures from routing
   - 5-second timeout prevents slow queries from blocking
   - Allows 50% error rate before opening

3. **Nearest Node Breaker**
   - Separate breaker for expensive spatial queries
   - Database index issues won't take down entire service

**State Machine**:
```
CLOSED (normal) --[5 failures]--> OPEN (fail fast)
OPEN --[30s timeout]--> HALF-OPEN (testing)
HALF-OPEN --[3 successes]--> CLOSED
HALF-OPEN --[1 failure]--> OPEN
```

### Idempotency (src/shared/idempotency.js)

**WHY**: Ensure exactly-once semantics for write operations:

1. **GPS Probe Ingestion**
   - Key: `deviceId:timestamp`
   - TTL: 1 hour (probes older than this are irrelevant)
   - Duplicates return cached result, don't reprocess

2. **Incident Reports**
   - Client provides `Idempotency-Key` header or `clientRequestId`
   - Merges nearby incidents rather than duplicating
   - TTL: 24 hours for replay protection

3. **Implementation**:
   ```
   1. Check Redis for existing key
   2. If processing: return 409 Conflict with retryAfter
   3. If completed: return cached result (replay)
   4. If new: SET NX to acquire lock
   5. Process request
   6. Store result with TTL
   ```

4. **Failure Handling**:
   - Failed requests marked with short TTL to allow retry
   - Processing timeout (60s) prevents stuck locks

### Rate Limiting (src/shared/rateLimit.js)

**WHY**: Protect system from abuse and ensure fair usage:

| Endpoint | Limit | Rationale |
|----------|-------|-----------|
| General API | 100/min | Baseline protection |
| Routing | 30/min | CPU-intensive A* algorithm |
| Search | 60/min | Database full-text search |
| Geocoding | 45/min | Spatial query overhead |
| Traffic data | 120/min | Frequent client polling |
| Incident report | 10/min | Prevent spam |
| GPS probe | 600/min | Navigation updates (10/sec max) |

**Headers Returned**:
- `RateLimit-Limit`: Maximum requests in window
- `RateLimit-Remaining`: Requests left in current window
- `RateLimit-Reset`: Unix timestamp when window resets

### Health Checks (src/routes/health.js)

**WHY**: Enable load balancer and orchestrator decisions:

1. **Full Health Check** (`GET /health`)
   - Checks all dependencies: PostgreSQL, Redis, routing graph, traffic freshness
   - Returns 503 if any critical check fails
   - Includes circuit breaker status for debugging

2. **Liveness Probe** (`GET /health/live`)
   - Returns 200 if process is running
   - Kubernetes uses this to decide container restart

3. **Readiness Probe** (`GET /health/ready`)
   - Returns 200 only if service can handle traffic
   - Checks database and cache connectivity
   - Load balancer removes instance if unhealthy

**Response Example**:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "uptime": 3600.5,
  "checks": {
    "database": { "status": "healthy", "latencyMs": 2 },
    "cache": { "status": "healthy", "latencyMs": 1 },
    "routingGraph": { "status": "healthy", "nodes": 2500 },
    "trafficData": { "status": "healthy", "freshnessRatio": "95%" }
  },
  "circuitBreakers": {
    "routing_graph_load": { "state": "CLOSED" },
    "geocoding": { "state": "CLOSED" }
  }
}
```

### Graceful Shutdown

**WHY**: Prevent data loss and connection leaks during deployments:

1. Handle `SIGTERM` and `SIGINT` signals
2. Stop accepting new requests
3. Wait for in-flight requests to complete (max 10s)
4. Close database connection pool
5. Disconnect from Redis
6. Exit cleanly

### Module Summary

| Module | File | Purpose |
|--------|------|---------|
| Logger | `src/shared/logger.js` | Structured logging with pino |
| Metrics | `src/shared/metrics.js` | Prometheus metrics collection |
| Circuit Breaker | `src/shared/circuitBreaker.js` | Failure isolation with opossum |
| Idempotency | `src/shared/idempotency.js` | Exactly-once write semantics |
| Rate Limiting | `src/shared/rateLimit.js` | Request throttling per endpoint |
| Health Checks | `src/routes/health.js` | Readiness and liveness probes |

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Full system health check |
| `/health/live` | GET | Liveness probe (is process alive?) |
| `/health/ready` | GET | Readiness probe (can serve traffic?) |
| `/metrics` | GET | Prometheus metrics endpoint |
| `/api/traffic/probe` | POST | Idempotent GPS probe ingestion |
| `/api/traffic/incidents` | POST | Idempotent incident reporting |
