import { create } from 'zustand';
import type { ExcalidrawElement, Tool, Cursor, ViewState, Point } from '../types';

interface CanvasState {
  // Elements
  elements: ExcalidrawElement[];
  selectedElementId: string | null;

  // Active tool
  activeTool: Tool;

  // Viewport
  viewState: ViewState;

  // Drawing state
  isDrawing: boolean;
  drawingStartPoint: Point | null;
  currentPoints: Point[];

  // Cursors
  cursors: Cursor[];

  // Style
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  opacity: number;
  fontSize: number;

  // Actions
  setElements: (elements: ExcalidrawElement[]) => void;
  addElement: (element: ExcalidrawElement) => void;
  updateElement: (id: string, updates: Partial<ExcalidrawElement>) => void;
  deleteElement: (id: string) => void;
  setSelectedElementId: (id: string | null) => void;
  setActiveTool: (tool: Tool) => void;
  setViewState: (viewState: Partial<ViewState>) => void;
  setIsDrawing: (isDrawing: boolean) => void;
  setDrawingStartPoint: (point: Point | null) => void;
  setCurrentPoints: (points: Point[]) => void;
  addCurrentPoint: (point: Point) => void;
  setCursors: (cursors: Cursor[]) => void;
  updateCursor: (cursor: Cursor) => void;
  removeCursor: (userId: string) => void;
  setStrokeColor: (color: string) => void;
  setFillColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setOpacity: (opacity: number) => void;
  setFontSize: (size: number) => void;
  clearCanvas: () => void;
}

export const useCanvasStore = create<CanvasState>()((set) => ({
  elements: [],
  selectedElementId: null,
  activeTool: 'select',
  viewState: { scrollX: 0, scrollY: 0, zoom: 1 },
  isDrawing: false,
  drawingStartPoint: null,
  currentPoints: [],
  cursors: [],
  strokeColor: '#1e1e1e',
  fillColor: 'transparent',
  strokeWidth: 2,
  opacity: 1,
  fontSize: 16,

  setElements: (elements) => set({ elements }),

  addElement: (element) =>
    set((state) => ({
      elements: [...state.elements, element],
    })),

  updateElement: (id, updates) =>
    set((state) => ({
      elements: state.elements.map((el) =>
        el.id === id ? { ...el, ...updates, version: el.version + 1, updatedAt: Date.now() } : el
      ),
    })),

  deleteElement: (id) =>
    set((state) => ({
      elements: state.elements.map((el) =>
        el.id === id ? { ...el, isDeleted: true, version: el.version + 1, updatedAt: Date.now() } : el
      ),
      selectedElementId: state.selectedElementId === id ? null : state.selectedElementId,
    })),

  setSelectedElementId: (id) => set({ selectedElementId: id }),

  setActiveTool: (tool) => set({ activeTool: tool, selectedElementId: null }),

  setViewState: (viewState) =>
    set((state) => ({
      viewState: { ...state.viewState, ...viewState },
    })),

  setIsDrawing: (isDrawing) => set({ isDrawing }),

  setDrawingStartPoint: (point) => set({ drawingStartPoint: point }),

  setCurrentPoints: (points) => set({ currentPoints: points }),

  addCurrentPoint: (point) =>
    set((state) => ({
      currentPoints: [...state.currentPoints, point],
    })),

  setCursors: (cursors) => set({ cursors }),

  updateCursor: (cursor) =>
    set((state) => {
      const existing = state.cursors.findIndex((c) => c.userId === cursor.userId);
      if (existing >= 0) {
        const updated = [...state.cursors];
        updated[existing] = cursor;
        return { cursors: updated };
      }
      return { cursors: [...state.cursors, cursor] };
    }),

  removeCursor: (userId) =>
    set((state) => ({
      cursors: state.cursors.filter((c) => c.userId !== userId),
    })),

  setStrokeColor: (color) => set({ strokeColor: color }),
  setFillColor: (color) => set({ fillColor: color }),
  setStrokeWidth: (width) => set({ strokeWidth: width }),
  setOpacity: (opacity) => set({ opacity }),
  setFontSize: (size) => set({ fontSize: size }),

  clearCanvas: () => set({ elements: [], selectedElementId: null }),
}));
