import pool from '../db.js';
import redis from '../redis.js';
import {
  PriorityQueue,
  haversineDistance,
  calculateBearing,
  calculateTurnAngle,
  formatDistance,
  formatDuration,
} from '../utils/geo.js';
import logger from '../shared/logger.js';
import {
  createCircuitBreaker,
  routingCircuitBreakerOptions,
} from '../shared/circuitBreaker.js';
import {
  routeCalculationDuration,
  routeNodesVisited,
  routeDistanceMeters,
  routeRequestsTotal,
  cacheHits,
  cacheMisses,
} from '../shared/metrics.js';
import type CircuitBreaker from 'opossum';

/**
 * Type definitions for routing
 */
interface RoadNode {
  id: string;
  lat: number;
  lng: number;
  isIntersection: boolean;
}

interface RoadEdge {
  id: string;
  targetNode: string;
  sourceNode: string;
  streetName: string;
  roadClass: string;
  length: number;
  freeFlowSpeed: number;
  isToll: boolean;
  isOneWay: boolean;
}

interface TrafficData {
  speed: number;
  congestion: string;
}

interface Graph {
  nodes: Map<string, RoadNode>;
  edges: Map<string, RoadEdge[]>;
}

interface NearestNode {
  id: string;
  lat: number;
  lng: number;
  distance: number;
}

interface RouteOptions {
  avoidTolls?: boolean;
  avoidHighways?: boolean;
}

interface Maneuver {
  type: string;
  instruction: string;
  distance: number;
  distanceFormatted?: string;
  location: RoadNode;
  streetName?: string;
}

interface RouteEdgeInfo {
  id: string;
  streetName: string;
  length: number;
  roadClass: string;
}

interface RouteResult {
  coordinates: Array<{ lat: number; lng: number }>;
  distance: number;
  distanceFormatted: string;
  duration: number;
  durationFormatted: string;
  maneuvers: Maneuver[];
  edges: RouteEdgeInfo[];
}

interface CameFromEntry {
  nodeId: string;
  edge: RoadEdge;
}

/**
 * Routing Engine using A* algorithm with traffic-aware weights
 * Enhanced with circuit breakers and metrics
 */
class RoutingService {
  private graphCache: Graph | null;
  private graphCacheTime: number | null;
  private readonly CACHE_TTL: number;
  private graphLoadBreaker: CircuitBreaker<[], Graph>;
  private nearestNodeBreaker: CircuitBreaker<[number, number], NearestNode | null>;

  constructor() {
    this.graphCache = null;
    this.graphCacheTime = null;
    this.CACHE_TTL = 60000; // 1 minute

    // Initialize circuit breaker for graph loading
    this.graphLoadBreaker = createCircuitBreaker<[], Graph>(
      'routing_graph_load',
      this._loadGraphFromDB.bind(this),
      routingCircuitBreakerOptions,
      async (): Promise<Graph> => {
        // Fallback: return cached graph if available
        if (this.graphCache) {
          logger.warn('Using stale graph cache as fallback');
          return this.graphCache;
        }
        throw new Error('No graph available');
      }
    );

    // Circuit breaker for finding nearest node (DB intensive)
    this.nearestNodeBreaker = createCircuitBreaker<[number, number], NearestNode | null>(
      'routing_nearest_node',
      this._findNearestNodeDB.bind(this),
      { ...routingCircuitBreakerOptions, timeout: 5000 }
    );
  }

  /**
   * Internal: Load road graph from database
   */
  private async _loadGraphFromDB(): Promise<Graph> {
    const nodesResult = await pool.query(`
      SELECT id, lat, lng, is_intersection
      FROM road_nodes
    `);

    const segmentsResult = await pool.query(`
      SELECT
        id, start_node_id, end_node_id, street_name, road_class,
        length_meters, free_flow_speed_kph, is_toll, is_one_way
      FROM road_segments
    `);

    // Build adjacency list
    const nodes = new Map<string, RoadNode>();
    const edges = new Map<string, RoadEdge[]>();

    for (const node of nodesResult.rows) {
      nodes.set(node.id, {
        id: node.id,
        lat: parseFloat(node.lat),
        lng: parseFloat(node.lng),
        isIntersection: node.is_intersection,
      });
      edges.set(node.id, []);
    }

    for (const segment of segmentsResult.rows) {
      const edge: RoadEdge = {
        id: segment.id,
        targetNode: segment.end_node_id,
        sourceNode: segment.start_node_id,
        streetName: segment.street_name,
        roadClass: segment.road_class,
        length: parseFloat(segment.length_meters),
        freeFlowSpeed: segment.free_flow_speed_kph,
        isToll: segment.is_toll,
        isOneWay: segment.is_one_way,
      };

      // Add forward edge
      const forwardEdges = edges.get(segment.start_node_id);
      if (forwardEdges) {
        forwardEdges.push(edge);
      }

      // Add reverse edge if not one-way
      if (!segment.is_one_way) {
        const reverseEdges = edges.get(segment.end_node_id);
        if (reverseEdges) {
          reverseEdges.push({
            ...edge,
            targetNode: segment.start_node_id,
            sourceNode: segment.end_node_id,
          });
        }
      }
    }

    logger.info({
      nodeCount: nodes.size,
      segmentCount: segmentsResult.rows.length,
    }, 'Road graph loaded');

    return { nodes, edges };
  }

  /**
   * Load road graph from database with caching and circuit breaker
   */
  async loadGraph(): Promise<Graph> {
    // Check cache
    if (this.graphCache && this.graphCacheTime && Date.now() - this.graphCacheTime < this.CACHE_TTL) {
      cacheHits.inc({ cache_name: 'routing_graph' });
      return this.graphCache;
    }

    cacheMisses.inc({ cache_name: 'routing_graph' });

    // Load through circuit breaker
    const graph = await this.graphLoadBreaker.fire();

    this.graphCache = graph;
    this.graphCacheTime = Date.now();

    return graph;
  }

  /**
   * Get traffic data for segments with caching
   */
  async getTrafficData(segmentIds: string[]): Promise<Map<string, TrafficData>> {
    if (segmentIds.length === 0) return new Map();

    // Try cache first
    const cacheKey = 'traffic:current';
    const cached = await redis.get(cacheKey);

    if (cached) {
      cacheHits.inc({ cache_name: 'traffic_data' });
      return new Map(Object.entries(JSON.parse(cached) as Record<string, TrafficData>));
    }

    cacheMisses.inc({ cache_name: 'traffic_data' });

    const result = await pool.query(`
      SELECT DISTINCT ON (segment_id)
        segment_id, speed_kph, congestion_level
      FROM traffic_flow
      WHERE segment_id = ANY($1)
      ORDER BY segment_id, timestamp DESC
    `, [segmentIds]);

    const trafficMap = new Map<string, TrafficData>();
    for (const row of result.rows) {
      trafficMap.set(row.segment_id, {
        speed: parseFloat(row.speed_kph),
        congestion: row.congestion_level,
      });
    }

    // Cache for 30 seconds
    await redis.setex(cacheKey, 30, JSON.stringify(Object.fromEntries(trafficMap)));

    return trafficMap;
  }

  /**
   * Internal: Find nearest node from database
   */
  private async _findNearestNodeDB(lat: number, lng: number): Promise<NearestNode | null> {
    const result = await pool.query(`
      SELECT id, lat, lng,
        ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) as distance
      FROM road_nodes
      ORDER BY location <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
      LIMIT 1
    `, [lat, lng]);

    if (result.rows.length === 0) {
      return null;
    }

    return {
      id: result.rows[0].id,
      lat: parseFloat(result.rows[0].lat),
      lng: parseFloat(result.rows[0].lng),
      distance: parseFloat(result.rows[0].distance),
    };
  }

  /**
   * Find nearest node to a coordinate with circuit breaker
   */
  async findNearestNode(lat: number, lng: number): Promise<NearestNode | null> {
    return this.nearestNodeBreaker.fire(lat, lng);
  }

  /**
   * A* pathfinding algorithm with metrics
   */
  async findRoute(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
    options: RouteOptions = {}
  ): Promise<RouteResult> {
    const { avoidTolls = false, avoidHighways = false } = options;
    const endTimer = routeCalculationDuration.startTimer({ route_type: 'primary' });
    let nodesVisitedCount = 0;

    try {
      // Load graph
      const { nodes, edges } = await this.loadGraph();

      // Find nearest nodes to origin and destination
      const startNode = await this.findNearestNode(originLat, originLng);
      const goalNode = await this.findNearestNode(destLat, destLng);

      if (!startNode || !goalNode) {
        routeRequestsTotal.inc({ status: 'no_route' });
        endTimer({ status: 'no_route' });
        throw new Error('Could not find nodes near origin or destination');
      }

      // Get all segment IDs for traffic lookup
      const allSegmentIds: string[] = [];
      for (const nodeEdges of edges.values()) {
        for (const edge of nodeEdges) {
          allSegmentIds.push(edge.id);
        }
      }

      // Get traffic data
      const trafficData = await this.getTrafficData([...new Set(allSegmentIds)]);

      // A* algorithm
      const openSet = new PriorityQueue();
      const cameFrom = new Map<string, CameFromEntry>();
      const gScore = new Map<string, number>();
      const fScore = new Map<string, number>();

      gScore.set(startNode.id, 0);
      fScore.set(startNode.id, this.heuristic(startNode, goalNode));
      openSet.enqueue(startNode.id, fScore.get(startNode.id) ?? 0);

      while (!openSet.isEmpty()) {
        const currentId = openSet.dequeue();
        if (!currentId) break;
        nodesVisitedCount++;

        if (currentId === goalNode.id) {
          const route = this.reconstructPath(
            cameFrom,
            currentId,
            nodes,
            trafficData,
            { originLat, originLng, destLat, destLng }
          );

          // Record metrics
          routeRequestsTotal.inc({ status: 'success' });
          routeNodesVisited.observe(nodesVisitedCount);
          routeDistanceMeters.observe(route.distance);
          endTimer({ status: 'success' });

          logger.debug({
            nodesVisited: nodesVisitedCount,
            distance: route.distance,
            duration: route.duration,
          }, 'Route calculated successfully');

          return route;
        }

        const _currentNode = nodes.get(currentId);
        const currentEdges = edges.get(currentId) || [];

        for (const edge of currentEdges) {
          // Apply constraints
          if (avoidTolls && edge.isToll) continue;
          if (avoidHighways && edge.roadClass === 'highway') continue;

          // Calculate edge weight (time in seconds)
          const traffic = trafficData.get(edge.id);
          const speed = traffic ? traffic.speed : edge.freeFlowSpeed;
          const weight = (edge.length / 1000) / (speed / 3600); // seconds

          const tentativeG = (gScore.get(currentId) ?? 0) + weight;
          const neighborG = gScore.get(edge.targetNode) ?? Infinity;

          if (tentativeG < neighborG) {
            cameFrom.set(edge.targetNode, { nodeId: currentId, edge });
            gScore.set(edge.targetNode, tentativeG);

            const neighborNode = nodes.get(edge.targetNode);
            const h = neighborNode ? this.heuristic(neighborNode, goalNode) : Infinity;
            fScore.set(edge.targetNode, tentativeG + h);

            openSet.enqueue(edge.targetNode, fScore.get(edge.targetNode) ?? 0);
          }
        }
      }

      // No route found
      routeRequestsTotal.inc({ status: 'no_route' });
      routeNodesVisited.observe(nodesVisitedCount);
      endTimer({ status: 'no_route' });

      logger.warn({
        origin: { lat: originLat, lng: originLng },
        destination: { lat: destLat, lng: destLng },
        nodesVisited: nodesVisitedCount,
      }, 'No route found');

      throw new Error('No route found');
    } catch (error) {
      const errorMessage = (error as Error).message;
      if (!errorMessage.includes('No route found') && !errorMessage.includes('Could not find')) {
        routeRequestsTotal.inc({ status: 'error' });
        endTimer({ status: 'error' });
        logger.error({ error }, 'Route calculation error');
      }
      throw error;
    }
  }

  /**
   * Heuristic function for A* (straight-line distance in time)
   */
  private heuristic(nodeA: RoadNode | NearestNode, nodeB: RoadNode | NearestNode): number {
    if (!nodeA || !nodeB) return Infinity;

    const distance = haversineDistance(nodeA.lat, nodeA.lng, nodeB.lat, nodeB.lng);
    // Assume highway speed (100 km/h) for optimistic estimate
    const timeSeconds = (distance / 1000) / (100 / 3600);
    return timeSeconds;
  }

  /**
   * Reconstruct path from A* result
   */
  private reconstructPath(
    cameFrom: Map<string, CameFromEntry>,
    goalId: string,
    nodes: Map<string, RoadNode>,
    trafficData: Map<string, TrafficData>,
    endpoints: { originLat: number; originLng: number; destLat: number; destLng: number }
  ): RouteResult {
    const path: RoadNode[] = [];
    const routeEdges: RoadEdge[] = [];
    let current = goalId;

    while (cameFrom.has(current)) {
      const entry = cameFrom.get(current);
      if (!entry) break;
      const { nodeId, edge } = entry;
      const node = nodes.get(current);
      if (node) {
        path.unshift(node);
      }
      routeEdges.unshift(edge);
      current = nodeId;
    }
    const startNode = nodes.get(current);
    if (startNode) {
      path.unshift(startNode);
    }

    // Calculate totals
    let totalDistance = 0;
    let totalTime = 0;

    for (const edge of routeEdges) {
      totalDistance += edge.length;
      const traffic = trafficData.get(edge.id);
      const speed = traffic ? traffic.speed : edge.freeFlowSpeed;
      totalTime += (edge.length / 1000) / (speed / 3600);
    }

    // Generate maneuvers
    const maneuvers = this.generateManeuvers(path, routeEdges);

    // Build path coordinates
    const coordinates = [
      { lat: endpoints.originLat, lng: endpoints.originLng },
      ...path.map(n => ({ lat: n.lat, lng: n.lng })),
      { lat: endpoints.destLat, lng: endpoints.destLng },
    ];

    return {
      coordinates,
      distance: totalDistance,
      distanceFormatted: formatDistance(totalDistance),
      duration: Math.round(totalTime),
      durationFormatted: formatDuration(totalTime),
      maneuvers,
      edges: routeEdges.map(e => ({
        id: e.id,
        streetName: e.streetName,
        length: e.length,
        roadClass: e.roadClass,
      })),
    };
  }

  /**
   * Generate turn-by-turn maneuvers
   */
  private generateManeuvers(path: RoadNode[], edges: RoadEdge[]): Maneuver[] {
    const maneuvers: Maneuver[] = [];
    let cumulativeDistance = 0;

    // Start maneuver
    if (path[0]) {
      maneuvers.push({
        type: 'depart',
        instruction: `Start on ${edges[0]?.streetName || 'the road'}`,
        distance: 0,
        location: path[0],
      });
    }

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const nextEdge = edges[i + 1];

      if (!edge) continue;
      cumulativeDistance += edge.length;

      if (nextEdge) {
        // Calculate turn angle
        const currentNode = path[i + 1];
        const prevNode = path[i];
        const nextNode = path[i + 2];

        if (currentNode && prevNode && nextNode) {
          const bearing1 = calculateBearing(prevNode.lat, prevNode.lng, currentNode.lat, currentNode.lng);
          const bearing2 = calculateBearing(currentNode.lat, currentNode.lng, nextNode.lat, nextNode.lng);
          const turnAngle = calculateTurnAngle(bearing1, bearing2);

          const turnType = this.classifyTurn(turnAngle);

          if (turnType !== 'straight') {
            maneuvers.push({
              type: turnType,
              instruction: this.generateInstruction(edge, nextEdge, turnType),
              distance: cumulativeDistance,
              distanceFormatted: formatDistance(cumulativeDistance),
              location: currentNode,
              streetName: nextEdge.streetName,
            });

            cumulativeDistance = 0;
          }
        }
      } else {
        // Arrive maneuver
        const lastNode = path[path.length - 1];
        if (lastNode) {
          maneuvers.push({
            type: 'arrive',
            instruction: 'You have arrived at your destination',
            distance: cumulativeDistance,
            distanceFormatted: formatDistance(cumulativeDistance),
            location: lastNode,
          });
        }
      }
    }

    return maneuvers;
  }

  /**
   * Classify turn angle into turn type
   */
  private classifyTurn(angle: number): string {
    const absAngle = Math.abs(angle);

    if (absAngle < 15) return 'straight';
    if (absAngle < 45) return angle > 0 ? 'slight-right' : 'slight-left';
    if (absAngle < 120) return angle > 0 ? 'right' : 'left';
    if (absAngle < 160) return angle > 0 ? 'sharp-right' : 'sharp-left';
    return 'u-turn';
  }

  /**
   * Generate instruction text for a maneuver
   */
  private generateInstruction(_currentEdge: RoadEdge, nextEdge: RoadEdge, turnType: string): string {
    const turnPhrase: Record<string, string> = {
      'slight-right': 'Keep right onto',
      'slight-left': 'Keep left onto',
      'right': 'Turn right onto',
      'left': 'Turn left onto',
      'sharp-right': 'Turn sharp right onto',
      'sharp-left': 'Turn sharp left onto',
      'u-turn': 'Make a U-turn onto',
    };

    const streetName = nextEdge.streetName || 'the road';
    return `${turnPhrase[turnType] || 'Continue onto'} ${streetName}`;
  }

  /**
   * Find alternative routes by penalizing primary route edges
   */
  async findAlternatives(
    _originLat: number,
    _originLng: number,
    _destLat: number,
    _destLng: number,
    _primaryRoute: RouteResult,
    _options: RouteOptions = {}
  ): Promise<RouteResult[]> {
    // For now, return empty alternatives
    // Full implementation would penalize edges in primary route
    return [];
  }
}

export default new RoutingService();
