/**
 * @fileoverview Dashboard and panel API routes.
 *
 * Exposes REST endpoints for:
 * - Dashboard CRUD operations (list, get, create, update, delete)
 * - Panel management within dashboards
 * - Panel data fetching for rendering visualizations
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  createDashboard,
  getDashboard,
  getDashboards,
  updateDashboard,
  deleteDashboard,
  createPanel,
  getPanel,
  getPanelsByDashboard,
  updatePanel,
  deletePanel,
  getDashboardWithPanels,
} from '../services/dashboardService.js';
import { queryMetrics } from '../services/queryService.js';
import type { PanelQuery } from '../types/index.js';

const router = Router();

/**
 * Zod schema for dashboard grid layout configuration.
 */
const DashboardLayoutSchema = z.object({
  columns: z.number().min(1).max(24).default(12),
  rows: z.number().min(1).max(24).default(8),
});

/**
 * Zod schema for dashboard creation requests.
 */
const CreateDashboardSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  layout: DashboardLayoutSchema.optional(),
  is_public: z.boolean().optional(),
});

/**
 * Zod schema for dashboard update requests.
 */
const UpdateDashboardSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  layout: DashboardLayoutSchema.optional(),
  is_public: z.boolean().optional(),
});

/**
 * Zod schema for panel metric query configuration.
 */
const PanelQuerySchema = z.object({
  metric_name: z.string().min(1),
  tags: z.record(z.string()).optional(),
  aggregation: z.enum(['avg', 'min', 'max', 'sum', 'count']).default('avg'),
  interval: z.string().optional(),
  group_by: z.array(z.string()).optional(),
});

/**
 * Zod schema for panel grid position.
 */
const PanelPositionSchema = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().min(1),
  height: z.number().min(1),
});

/**
 * Zod schema for threshold configuration in panel options.
 */
const ThresholdSchema = z.object({
  value: z.number(),
  color: z.string(),
});

/**
 * Zod schema for panel display options (colors, units, thresholds).
 */
const PanelOptionsSchema = z.object({
  color: z.string().optional(),
  unit: z.string().optional(),
  decimals: z.number().min(0).max(10).optional(),
  thresholds: z.array(ThresholdSchema).optional(),
  legend: z.boolean().optional(),
});

/**
 * Zod schema for panel creation requests.
 */
const CreatePanelSchema = z.object({
  title: z.string().min(1).max(255),
  panel_type: z.enum(['line_chart', 'area_chart', 'bar_chart', 'gauge', 'stat', 'table']),
  query: PanelQuerySchema,
  position: PanelPositionSchema,
  options: PanelOptionsSchema.optional(),
});

/**
 * Zod schema for panel update requests.
 */
const UpdatePanelSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  panel_type: z.enum(['line_chart', 'area_chart', 'bar_chart', 'gauge', 'stat', 'table']).optional(),
  query: PanelQuerySchema.optional(),
  position: PanelPositionSchema.optional(),
  options: PanelOptionsSchema.optional(),
});

/**
 * GET /
 * Lists all accessible dashboards for the current user.
 * Includes user's own dashboards plus public dashboards.
 *
 * @returns {dashboards: Dashboard[]} - Array of dashboards
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    const dashboards = await getDashboards({ userId, includePublic: true });
    res.json({ dashboards });
  } catch (error) {
    console.error('Get dashboards error:', error);
    res.status(500).json({ error: 'Failed to get dashboards' });
  }
});

/**
 * GET /:id
 * Retrieves a single dashboard with all its panels.
 *
 * @param id - Dashboard UUID
 * @returns Dashboard with panels array
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const dashboard = await getDashboardWithPanels(req.params.id);
    if (!dashboard) {
      return res.status(404).json({ error: 'Dashboard not found' });
    }
    res.json(dashboard);
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ error: 'Failed to get dashboard' });
  }
});

/**
 * POST /
 * Creates a new dashboard.
 *
 * @body {name, description?, layout?, is_public?}
 * @returns The newly created dashboard
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const validation = CreateDashboardSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: validation.error.errors,
      });
    }

    const { name, description, layout, is_public } = validation.data;
    const userId = req.session?.userId;

    const dashboard = await createDashboard(name, {
      userId,
      description,
      layout,
      isPublic: is_public,
    });

    res.status(201).json(dashboard);
  } catch (error) {
    console.error('Create dashboard error:', error);
    res.status(500).json({ error: 'Failed to create dashboard' });
  }
});

/**
 * PUT /:id
 * Updates an existing dashboard's properties.
 *
 * @param id - Dashboard UUID
 * @body Partial dashboard properties to update
 * @returns The updated dashboard
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const validation = UpdateDashboardSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: validation.error.errors,
      });
    }

    const dashboard = await updateDashboard(req.params.id, validation.data);
    if (!dashboard) {
      return res.status(404).json({ error: 'Dashboard not found' });
    }

    res.json(dashboard);
  } catch (error) {
    console.error('Update dashboard error:', error);
    res.status(500).json({ error: 'Failed to update dashboard' });
  }
});

/**
 * DELETE /:id
 * Deletes a dashboard and all its panels.
 *
 * @param id - Dashboard UUID
 * @returns 204 No Content on success
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await deleteDashboard(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Dashboard not found' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Delete dashboard error:', error);
    res.status(500).json({ error: 'Failed to delete dashboard' });
  }
});

/**
 * GET /:dashboardId/panels
 * Lists all panels in a dashboard.
 *
 * @param dashboardId - Parent dashboard UUID
 * @returns {panels: Panel[]} - Array of panels
 */
router.get('/:dashboardId/panels', async (req: Request, res: Response) => {
  try {
    const panels = await getPanelsByDashboard(req.params.dashboardId);
    res.json({ panels });
  } catch (error) {
    console.error('Get panels error:', error);
    res.status(500).json({ error: 'Failed to get panels' });
  }
});

/**
 * GET /:dashboardId/panels/:panelId
 * Retrieves a single panel.
 *
 * @param dashboardId - Parent dashboard UUID
 * @param panelId - Panel UUID
 * @returns The panel if found
 */
router.get('/:dashboardId/panels/:panelId', async (req: Request, res: Response) => {
  try {
    const panel = await getPanel(req.params.panelId);
    if (!panel || panel.dashboard_id !== req.params.dashboardId) {
      return res.status(404).json({ error: 'Panel not found' });
    }
    res.json(panel);
  } catch (error) {
    console.error('Get panel error:', error);
    res.status(500).json({ error: 'Failed to get panel' });
  }
});

/**
 * POST /:dashboardId/panels
 * Creates a new panel on a dashboard.
 *
 * @param dashboardId - Parent dashboard UUID
 * @body {title, panel_type, query, position, options?}
 * @returns The newly created panel
 */
router.post('/:dashboardId/panels', async (req: Request, res: Response) => {
  try {
    const validation = CreatePanelSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: validation.error.errors,
      });
    }

    const { title, panel_type, query, position, options } = validation.data;

    const panel = await createPanel(req.params.dashboardId, {
      title,
      panelType: panel_type,
      query,
      position,
      panelOptions: options,
    });

    res.status(201).json(panel);
  } catch (error) {
    console.error('Create panel error:', error);
    res.status(500).json({ error: 'Failed to create panel' });
  }
});

/**
 * PUT /:dashboardId/panels/:panelId
 * Updates an existing panel's properties.
 *
 * @param dashboardId - Parent dashboard UUID
 * @param panelId - Panel UUID
 * @body Partial panel properties to update
 * @returns The updated panel
 */
router.put('/:dashboardId/panels/:panelId', async (req: Request, res: Response) => {
  try {
    const validation = UpdatePanelSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: validation.error.errors,
      });
    }

    const { title, panel_type, query, position, options } = validation.data;

    const panel = await updatePanel(req.params.panelId, {
      title,
      panelType: panel_type,
      query,
      position,
      options,
    });

    if (!panel) {
      return res.status(404).json({ error: 'Panel not found' });
    }

    res.json(panel);
  } catch (error) {
    console.error('Update panel error:', error);
    res.status(500).json({ error: 'Failed to update panel' });
  }
});

/**
 * DELETE /:dashboardId/panels/:panelId
 * Deletes a panel from a dashboard.
 *
 * @param dashboardId - Parent dashboard UUID
 * @param panelId - Panel UUID
 * @returns 204 No Content on success
 */
router.delete('/:dashboardId/panels/:panelId', async (req: Request, res: Response) => {
  try {
    const deleted = await deletePanel(req.params.panelId);
    if (!deleted) {
      return res.status(404).json({ error: 'Panel not found' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Delete panel error:', error);
    res.status(500).json({ error: 'Failed to delete panel' });
  }
});

/**
 * POST /:dashboardId/panels/:panelId/data
 * Fetches metric data for a panel based on its query configuration.
 * Used by the frontend to render panel visualizations.
 *
 * @param dashboardId - Parent dashboard UUID
 * @param panelId - Panel UUID
 * @body {start_time?, end_time?} - Optional time range (defaults to last hour)
 * @returns {results: QueryResult[]} - Time-series data for the panel
 */
router.post('/:dashboardId/panels/:panelId/data', async (req: Request, res: Response) => {
  try {
    const panel = await getPanel(req.params.panelId);
    if (!panel || panel.dashboard_id !== req.params.dashboardId) {
      return res.status(404).json({ error: 'Panel not found' });
    }

    const { start_time, end_time } = req.body;
    const panelQuery = panel.query as PanelQuery;

    const results = await queryMetrics({
      metric_name: panelQuery.metric_name,
      tags: panelQuery.tags,
      start_time: new Date(start_time || Date.now() - 60 * 60 * 1000),
      end_time: new Date(end_time || Date.now()),
      aggregation: panelQuery.aggregation,
      interval: panelQuery.interval || '1m',
      group_by: panelQuery.group_by,
    });

    res.json({ results });
  } catch (error) {
    console.error('Get panel data error:', error);
    res.status(500).json({ error: 'Failed to get panel data' });
  }
});

export default router;
