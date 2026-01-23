# Apple Maps - System Design Answer (Backend Focus)

*45-minute system design interview format - Backend Engineer Position*

## Opening Statement (1 minute)

"I'll design Apple Maps from a backend perspective, focusing on the routing engine, traffic data pipeline, and map tile serving. The key challenges are computing optimal routes in under 500ms using graph algorithms with hierarchical preprocessing, aggregating real-time traffic from millions of GPS probes, and serving vector tiles efficiently at global scale.

As a backend engineer, I'll emphasize the graph database design, A* algorithm with Contraction Hierarchies, GPS probe ingestion pipeline, and the observability infrastructure needed to maintain SLIs."

## Requirements Clarification (3 minutes)

### Functional Requirements (Backend Scope)
- **Routing API**: Calculate optimal routes between coordinates with traffic-aware ETA
- **Traffic Pipeline**: Ingest and aggregate GPS probes from millions of devices
- **Map Matching**: Snap GPS coordinates to road network segments
- **Incident Detection**: Detect and propagate traffic incidents in real-time
- **Geocoding**: Convert addresses to coordinates and vice versa
- **POI Search**: Full-text search for points of interest

### Non-Functional Requirements
- **Latency**: < 500ms for route calculation (p95)
- **Throughput**: Process billions of GPS probes per day
- **Accuracy**: ETA within 10% of actual travel time
- **Availability**: 99.9% uptime for routing service

### Scale Estimates
- Road network: ~50 million road segments globally
- GPS probes: 10,000+ per second at peak
- Active navigators: Millions concurrent
- Traffic updates: Every minute per segment

## High-Level Architecture (5 minutes)

```
                              ┌─────────────────────────────────┐
                              │          API Gateway            │
                              │   (Rate Limiting, Auth, CDN)    │
                              └─────────────────────────────────┘
                                             │
            ┌────────────────────────────────┼────────────────────────────────┐
            │                                │                                │
            ▼                                ▼                                ▼
┌──────────────────────┐     ┌──────────────────────────┐     ┌─────────────────────┐
│   Routing Service    │     │    Traffic Service       │     │    Map Service      │
│                      │     │                          │     │                     │
│ - A* with CH         │     │ - GPS probe ingestion    │     │ - Tile generation   │
│ - Traffic-aware ETA  │     │ - Segment aggregation    │     │ - POI search        │
│ - Alternative routes │     │ - Incident detection     │     │ - Geocoding         │
│ - Maneuver gen       │     │ - Historical patterns    │     │ - Reverse geocode   │
└──────────────────────┘     └──────────────────────────┘     └─────────────────────┘
            │                                │                                │
            ▼                                ▼                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    Data Layer                                        │
├────────────────────────┬─────────────────────────┬──────────────────────────────────┤
│ PostgreSQL + PostGIS   │    Redis/Valkey         │          MinIO (S3)              │
│ - road_nodes           │    - Traffic cache      │          - Vector tiles          │
│ - road_segments        │    - Probe dedup        │          - Tile bundles          │
│ - traffic_flow         │    - Session store      │          - Offline packages      │
│ - incidents            │    - Rate limiting      │                                  │
│ - pois                 │                         │                                  │
└────────────────────────┴─────────────────────────┴──────────────────────────────────┘
```

## Deep Dive: Routing Engine (10 minutes)

### Graph Data Model

> "I'm storing the road network in PostgreSQL with PostGIS extensions. The graph has two core tables: road_nodes (vertices at intersections) and road_segments (edges representing road sections)."

**road_nodes table:** id, location (PostGIS Point), lat/lng coordinates, and an is_intersection flag. Spatial index on location enables efficient nearest-node queries.

**road_segments table:** id, start_node_id, end_node_id, geometry (PostGIS LineString), street_name, road_class (highway/arterial/local), length_meters, free_flow_speed, toll and one-way flags, and turn_restrictions as JSONB. Indexes on geometry (GIST), start_node_id, and end_node_id enable fast graph traversal.

### A* Algorithm with Traffic-Aware Weights

> "The core routing uses A* with real-time traffic weights. We fetch traffic data for the bounding box, apply weights to graph edges, then run A* with a hierarchical shortcut graph for speed."

**Route calculation flow:**
1. Get traffic data for the origin-destination bounding box
2. Apply traffic weights to graph edges (travel time = distance / current_speed)
3. Find nearest graph nodes to origin and destination
4. Run A* with hierarchical shortcuts enabled
5. Generate turn-by-turn maneuvers from the path
6. Calculate total distance and ETA

**A* implementation:** Uses a priority queue with g-score (actual cost from start) and f-score (g + heuristic). The heuristic is Haversine distance / max highway speed, ensuring admissibility. We support constraints like avoiding tolls or highways by skipping edges during expansion.

### Contraction Hierarchies (Preprocessing)

> "For production scale, plain A* on 50 million segments is too slow. Contraction Hierarchies precompute shortcut edges that let us skip intermediate nodes, achieving 1000x speedup for long routes."

**Offline preprocessing (hours for full map):**
1. Order nodes by importance (local roads → collectors → arterials → highways)
2. Contract nodes in order, starting with least important
3. For each contracted node, check if removing it would break shortest paths
4. If yes, add a shortcut edge that preserves the shortest path distance
5. Store shortcuts with the original graph

**Query time benefit:** Long routes traverse mostly shortcuts on highways, checking far fewer nodes. A cross-country route might evaluate thousands of nodes instead of millions.

### Alternative Routes with Penalty Method

> "For alternative routes, I use the penalty method rather than k-shortest paths. After finding the primary route, I penalize all edges in that route by 50%, then run A* again. This naturally finds the next-best path that avoids the primary route's segments."

**Algorithm flow:**
1. Calculate primary route using standard A*
2. Create a penalized graph copy where edges in the primary route have 1.5x weight
3. Run A* on penalized graph to find first alternative
4. Check if alternative is "different enough" (< 70% overlap with primary)
5. If yes, penalize again and find second alternative

**Diversity threshold:** Routes must share less than 70% of edges to be considered distinct alternatives. This prevents showing nearly-identical routes that differ only in one short segment.

## Deep Dive: Traffic Service (8 minutes)

### GPS Probe Ingestion Pipeline

> "GPS probes arrive at 10,000+ per second at peak. Each probe contains device ID, coordinates, speed, heading, and timestamp. The pipeline must deduplicate, map-match to road segments, aggregate speeds, and detect incidents—all with minimal latency."

**Probe processing flow:**
1. **Idempotency check**: Use Redis SET with TTL to deduplicate probes (key: `probe:{deviceId}:{timestamp}`, 1-hour TTL)
2. **Map matching**: Snap GPS coordinates to nearest road segment (see algorithm below)
3. **Speed aggregation**: Update segment flow using exponential moving average (α = 0.1)
4. **Incident detection**: If speed drops below 30% of free flow and multiple probes confirm, flag potential incident
5. **Batch persistence**: Queue traffic updates for batched writes to PostgreSQL

**Exponential moving average (EMA):** New speed = α × probe_speed + (1 - α) × current_avg. This smooths out GPS jitter and individual driver variations while responding to real traffic changes.

**Congestion classification:**
- **Free flow**: current speed > 80% of free flow speed
- **Light**: 50-80% of free flow
- **Moderate**: 25-50% of free flow
- **Heavy**: < 25% of free flow

**Confidence levels:** Low confidence when using historical/predicted data (no recent probes), medium with 1-5 samples, high with 5+ samples in the last few minutes.

### Map Matching Algorithm

> "Map matching snaps noisy GPS coordinates to the most likely road segment. I use a simple scoring approach that considers both distance and heading alignment, rather than a full Hidden Markov Model which would be overkill for individual probes."

**Matching algorithm:**
1. Query PostGIS for all road segments within 50 meters of the GPS point
2. For each candidate segment, calculate:
   - **Distance score**: How far the GPS point is from the segment centerline
   - **Heading score**: Difference between GPS heading and segment bearing (from start to end point)
3. Combine scores: total = distance + (heading_diff × 0.5)
4. Return segment with lowest score

**PostGIS query optimization:** Use `ST_DWithin(geometry, point, 50)` with a spatial GIST index for efficient candidate retrieval. The bearing calculation uses `ST_Azimuth` between segment start and end points.

**Heading normalization:** Angles are normalized to [-180, 180] range before computing differences to handle wraparound correctly.

### Incident Detection

> "Incident detection requires multiple slow probes to avoid false positives from individual drivers stopping. When 5+ probes in 5 minutes report speeds below 30% of free flow, we flag a potential incident."

**Detection algorithm:**
1. When a probe reports very slow speed (< 30% free flow), query recent probes on the same segment
2. Count how many probes in the last 5 minutes also reported slow speeds
3. If count ≥ 5, check for existing nearby incidents (100m radius)
4. If existing incident found, merge by incrementing confidence
5. Otherwise, create new incident with type='congestion' and severity based on probe count

**Incident merging:** Rather than creating duplicate incidents, nearby reports merge into a single incident with increasing confidence scores. This handles the case where multiple users report the same slowdown.

**Confidence scoring:** Confidence starts low and increases with each confirming probe, capped at 1.0. This helps distinguish between brief slowdowns (one stopped vehicle) and actual incidents requiring rerouting.

**Propagation:** When an incident is created or updated, publish to the routing service so it can apply appropriate penalties to affected segments.

### Traffic Flow Persistence

> "Traffic updates are batched and written using PostgreSQL UPSERT (INSERT ON CONFLICT). We aggregate to minute-level buckets to reduce row count while maintaining granularity."

**Persistence strategy:**
- **Bucket by minute**: Traffic flow table uses (segment_id, minute_bucket) as the primary key
- **Running average on conflict**: When a new probe arrives for the same segment/minute, update the average rather than inserting a new row
- **Sample count tracking**: Track number of probes per bucket to compute proper weighted average
- **Congestion level update**: Recalculate congestion level based on new averaged speed

This approach keeps the traffic_flow table manageable (one row per segment per minute) while still capturing all probe data.

## Deep Dive: Observability (5 minutes)

### Observability Strategy

> "I'm instrumenting three metric categories: routing latency histograms, traffic ingestion counters, and infrastructure gauges. Combined with structured health checks and circuit breakers, this gives us the visibility needed to maintain our SLIs."

**Key Prometheus metrics:**
- `routing_calculation_duration_seconds` (histogram): Route calculation latency by route_type and status, with buckets at 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s
- `traffic_probes_ingested_total` (counter): GPS probes processed, labeled by status (success, dedupe_skip, map_match_failed)
- `circuit_breaker_state` (gauge): Current state for each breaker (0=closed, 0.5=half-open, 1=open)

### Health Check Design

> "Health checks verify not just connectivity but data freshness. A routing service with stale traffic data is degraded even if the database responds."

**Health check components:**
- **Database**: PostgreSQL connection pool health
- **Cache**: Redis connectivity
- **Routing graph**: Verify graph is loaded with expected node count (> 100 nodes = healthy)
- **Traffic freshness**: Percentage of segments with updates in last 5 minutes (> 80% = healthy)

The `/health` endpoint returns 200 if all checks pass, 503 if any are unhealthy. It also reports circuit breaker states for the load balancer to consider.

### Circuit Breaker Pattern

> "Circuit breakers prevent cascade failures when dependencies slow down. If graph loading times out repeatedly, we fall back to the cached graph rather than blocking all routing requests."

**Configuration:**
- **Timeout**: 5 seconds before request is considered failed
- **Error threshold**: Open circuit after 50% of requests fail
- **Reset timeout**: Try again after 30 seconds in half-open state
- **Fallback**: Return stale cached data when circuit is open

Key breakers: routing graph load, geocoding service, traffic data refresh. Each breaker state is exposed as a Prometheus gauge for alerting.

## Trade-offs and Alternatives (3 minutes)

| Decision | Chosen | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Routing algorithm | ✅ Contraction Hierarchies | ❌ Plain Dijkstra | 1000x speedup for long routes; preprocessing done offline |
| Traffic source | ✅ GPS probe aggregation | ❌ Road sensors | Coverage everywhere users drive; no sensor installation |
| Graph storage | ✅ PostgreSQL + PostGIS | ❌ Neo4j | PostGIS spatial indexes; familiar SQL; simpler ops |
| Traffic consistency | ✅ Eventual (EMA) | ❌ Strong | High write volume; stale data acceptable for seconds |
| Probe deduplication | ✅ Redis with TTL | ❌ Database unique constraint | Performance at 10K+ probes/second |
| Map format | ✅ Vector tiles | ❌ Raster tiles | Smaller downloads; client-side styling; smooth rotation |

## Closing Summary (1 minute)

"The Apple Maps backend is built around three core innovations:

1. **Contraction Hierarchies** - By preprocessing shortcut edges during offline computation, we achieve millisecond route queries instead of seconds. The preprocessing takes hours but is done once when map data updates.

2. **GPS Probe Aggregation** - Traffic data comes from exponential moving average of anonymous GPS probes. The key insight is requiring multiple slow reports before flagging incidents, reducing false positives.

3. **Observability-First Design** - Every routing request is instrumented with Prometheus histograms, circuit breakers protect against cascade failures, and health checks enable automated failover.

The main trade-off is preprocessing time vs. query speed. For a navigation service where route calculation must be sub-second, this investment in offline preprocessing is essential."

## Future Enhancements (Backend)

1. **ML-based ETA Prediction**: Train models on historical trip data for more accurate arrival times
2. **Kafka for Probe Ingestion**: Replace direct database writes with event streaming for higher throughput
3. **ClickHouse for Traffic Analytics**: Columnar storage for traffic pattern analysis
4. **Geographic Sharding**: Partition road graph by H3 cells for horizontal scaling
5. **Hidden Markov Model Map Matching**: More accurate GPS-to-road snapping for sparse or noisy data
