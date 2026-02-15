import { useRef, useEffect, useCallback, useState } from 'react';
import { useCanvasStore } from '../stores/canvasStore';
import { useAuthStore } from '../stores/authStore';
import { renderCanvas } from '../renderer/CanvasRenderer';
import { hitTest, generateId } from '../utils/geometry';
import { simplifyPath } from '../utils/pathSimplification';
import { wsClient } from '../services/websocket';
import type { ExcalidrawElement, Point } from '../types';

/** Renders the main drawing canvas with mouse/touch event handling for shapes. */
export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const isPanning = useRef(false);
  const panStart = useRef<Point>({ x: 0, y: 0 });
  const spacePressed = useRef(false);

  const {
    elements,
    selectedElementId,
    activeTool,
    viewState,
    isDrawing,
    drawingStartPoint,
    currentPoints,
    strokeColor,
    fillColor,
    strokeWidth,
    opacity,
    fontSize,
    setElements,
    addElement,
    updateElement,
    setSelectedElementId,
    setActiveTool,
    setViewState,
    setIsDrawing,
    setDrawingStartPoint,
    setCurrentPoints,
    addCurrentPoint,
  } = useCanvasStore();

  const { user } = useAuthStore();

  // Resize canvas to fill container
  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanvasSize({ width: width * 2, height: height * 2 }); // 2x for retina
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, []);

  // Re-render canvas on state changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Scale for retina
    ctx.setTransform(2, 0, 0, 2, 0, 0);

    const visibleElements = elements.filter((el) => !el.isDeleted);
    renderCanvas(ctx, visibleElements, viewState, selectedElementId, canvasSize.width / 2, canvasSize.height / 2);
  }, [elements, viewState, selectedElementId, canvasSize]);

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = useCallback(
    (screenX: number, screenY: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: screenX, y: screenY };

      const rect = canvas.getBoundingClientRect();
      const x = (screenX - rect.left - viewState.scrollX) / viewState.zoom;
      const y = (screenY - rect.top - viewState.scrollY) / viewState.zoom;
      return { x, y };
    },
    [viewState]
  );

  // Create a new element from current tool
  const createElement = useCallback(
    (startX: number, startY: number): ExcalidrawElement => {
      return {
        id: generateId(),
        type: activeTool === 'select' ? 'rectangle' : activeTool,
        x: startX,
        y: startY,
        width: 0,
        height: 0,
        points: activeTool === 'freehand' || activeTool === 'line' || activeTool === 'arrow' ? [{ x: 0, y: 0 }] : undefined,
        text: activeTool === 'text' ? '' : undefined,
        strokeColor,
        fillColor,
        strokeWidth,
        opacity,
        fontSize: activeTool === 'text' ? fontSize : undefined,
        version: 1,
        isDeleted: false,
        createdBy: user?.id || 'anonymous',
        updatedAt: Date.now(),
      };
    },
    [activeTool, strokeColor, fillColor, strokeWidth, opacity, fontSize, user]
  );

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === ' ') {
        e.preventDefault();
        spacePressed.current = true;
      }

      switch (e.key) {
        case 'v':
        case 'V':
          setActiveTool('select');
          break;
        case 'r':
        case 'R':
          setActiveTool('rectangle');
          break;
        case 'o':
        case 'O':
          setActiveTool('ellipse');
          break;
        case 'd':
        case 'D':
          setActiveTool('diamond');
          break;
        case 'a':
        case 'A':
          if (!e.ctrlKey && !e.metaKey) setActiveTool('arrow');
          break;
        case 'l':
        case 'L':
          setActiveTool('line');
          break;
        case 'p':
        case 'P':
          setActiveTool('freehand');
          break;
        case 't':
        case 'T':
          setActiveTool('text');
          break;
        case 'Delete':
        case 'Backspace':
          if (selectedElementId) {
            updateElement(selectedElementId, { isDeleted: true });
            wsClient.sendShapeDelete(selectedElementId);
            setSelectedElementId(null);
          }
          break;
        case 'Escape':
          setSelectedElementId(null);
          setActiveTool('select');
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        spacePressed.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedElementId, setActiveTool, setSelectedElementId, updateElement]);

  // Mouse event handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const point = screenToCanvas(e.clientX, e.clientY);

      // Middle mouse button or space+left click for panning
      if (e.button === 1 || (e.button === 0 && spacePressed.current)) {
        isPanning.current = true;
        panStart.current = { x: e.clientX - viewState.scrollX, y: e.clientY - viewState.scrollY };
        return;
      }

      if (e.button !== 0) return;

      if (activeTool === 'select') {
        // Hit test
        const visibleElements = elements.filter((el) => !el.isDeleted);
        const hit = hitTest(point.x, point.y, visibleElements);
        setSelectedElementId(hit ? hit.id : null);

        if (hit) {
          // Start dragging
          setIsDrawing(true);
          setDrawingStartPoint({ x: point.x - hit.x, y: point.y - hit.y });
        }
      } else if (activeTool === 'text') {
        // Create text element
        const text = window.prompt('Enter text:');
        if (text) {
          const el = createElement(point.x, point.y);
          el.text = text;
          // Approximate width based on text length
          el.width = text.length * (fontSize * 0.6);
          el.height = fontSize * 1.4;
          addElement(el);
          wsClient.sendShapeAdd(el);
        }
        setActiveTool('select');
      } else {
        // Start drawing a shape
        setIsDrawing(true);
        setDrawingStartPoint(point);
        setCurrentPoints([{ x: 0, y: 0 }]);
      }
    },
    [activeTool, elements, viewState, screenToCanvas, createElement, fontSize, addElement, setActiveTool, setIsDrawing, setDrawingStartPoint, setCurrentPoints, setSelectedElementId]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const point = screenToCanvas(e.clientX, e.clientY);

      // Send cursor position over WebSocket
      wsClient.sendCursorMove(point.x, point.y);

      // Handle panning
      if (isPanning.current) {
        setViewState({
          scrollX: e.clientX - panStart.current.x,
          scrollY: e.clientY - panStart.current.y,
        });
        return;
      }

      if (!isDrawing || !drawingStartPoint) return;

      if (activeTool === 'select' && selectedElementId) {
        // Dragging selected element
        const newX = point.x - drawingStartPoint.x;
        const newY = point.y - drawingStartPoint.y;
        updateElement(selectedElementId, { x: newX, y: newY });
      } else if (activeTool === 'freehand') {
        // Add point to freehand path
        addCurrentPoint({
          x: point.x - drawingStartPoint.x,
          y: point.y - drawingStartPoint.y,
        });
      } else if (activeTool !== 'select') {
        // Update shape dimensions
        const dx = point.x - drawingStartPoint.x;
        const dy = point.y - drawingStartPoint.y;

        if (activeTool === 'line' || activeTool === 'arrow') {
          setCurrentPoints([{ x: 0, y: 0 }, { x: dx, y: dy }]);
        }

        // Preview is handled in render
      }
    },
    [isDrawing, drawingStartPoint, activeTool, selectedElementId, screenToCanvas, viewState, setViewState, updateElement, addCurrentPoint, setCurrentPoints]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Stop panning
      if (isPanning.current) {
        isPanning.current = false;
        return;
      }

      if (!isDrawing || !drawingStartPoint) return;

      const point = screenToCanvas(e.clientX, e.clientY);

      if (activeTool === 'select' && selectedElementId) {
        // Finish dragging - send update via WebSocket
        const el = elements.find((e) => e.id === selectedElementId);
        if (el) {
          wsClient.sendShapeMove({ ...el, version: el.version + 1, updatedAt: Date.now() });
        }
      } else if (activeTool !== 'select' && activeTool !== 'text') {
        // Finalize the shape
        const el = createElement(drawingStartPoint.x, drawingStartPoint.y);

        if (activeTool === 'freehand') {
          el.points = simplifyPath(currentPoints, 2);
          // Calculate bounding box
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of el.points) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          }
          el.width = maxX - minX;
          el.height = maxY - minY;
        } else if (activeTool === 'line' || activeTool === 'arrow') {
          const dx = point.x - drawingStartPoint.x;
          const dy = point.y - drawingStartPoint.y;
          el.points = [{ x: 0, y: 0 }, { x: dx, y: dy }];
          el.width = dx;
          el.height = dy;
        } else {
          el.width = point.x - drawingStartPoint.x;
          el.height = point.y - drawingStartPoint.y;
        }

        // Only add if shape has meaningful size
        if (Math.abs(el.width) > 2 || Math.abs(el.height) > 2 || (el.points && el.points.length > 2)) {
          addElement(el);
          wsClient.sendShapeAdd(el);
        }
      }

      setIsDrawing(false);
      setDrawingStartPoint(null);
      setCurrentPoints([]);
    },
    [isDrawing, drawingStartPoint, activeTool, selectedElementId, elements, currentPoints, screenToCanvas, createElement, addElement, setIsDrawing, setDrawingStartPoint, setCurrentPoints]
  );

  // Handle zoom with scroll wheel
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(5, viewState.zoom * zoomFactor));

      // Zoom centered on cursor position
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const newScrollX = mouseX - (mouseX - viewState.scrollX) * (newZoom / viewState.zoom);
      const newScrollY = mouseY - (mouseY - viewState.scrollY) * (newZoom / viewState.zoom);

      setViewState({
        zoom: newZoom,
        scrollX: newScrollX,
        scrollY: newScrollY,
      });
    },
    [viewState, setViewState]
  );

  // Determine cursor style
  const getCursorClass = (): string => {
    if (spacePressed.current || isPanning.current) return 'cursor-grab';
    if (activeTool === 'select') return 'cursor-default';
    if (activeTool === 'text') return 'cursor-text';
    return 'cursor-crosshair';
  };

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden bg-canvas-bg">
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        className={`w-full h-full ${getCursorClass()}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {/* Zoom indicator */}
      <div className="absolute bottom-4 right-4 bg-white rounded-lg shadow-md px-3 py-1 text-sm text-text-secondary">
        {Math.round(viewState.zoom * 100)}%
      </div>
    </div>
  );
}
