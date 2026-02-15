import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { KanbanColumn } from './KanbanColumn';
import { OpportunityCard } from './OpportunityCard';
import type { Opportunity } from '../types';
import { OPPORTUNITY_STAGES } from '../types';

interface KanbanBoardProps {
  opportunities: Opportunity[];
  onStageChange: (id: string, stage: string) => Promise<void>;
}

/** Renders the opportunity pipeline as a draggable Kanban board with stage columns using dnd-kit. */
export function KanbanBoard({ opportunities, onStageChange }: KanbanBoardProps) {
  const [activeOpp, setActiveOpp] = useState<Opportunity | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const stageGroups = OPPORTUNITY_STAGES.reduce<Record<string, Opportunity[]>>((acc, stage) => {
    acc[stage] = opportunities.filter((o) => o.stage === stage);
    return acc;
  }, {});

  const handleDragStart = (event: DragStartEvent) => {
    const opp = opportunities.find((o) => o.id === event.active.id);
    setActiveOpp(opp || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveOpp(null);

    if (!over) return;

    const oppId = active.id as string;
    const newStage = over.id as string;

    const opp = opportunities.find((o) => o.id === oppId);
    if (!opp || opp.stage === newStage) return;

    await onStageChange(oppId, newStage);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {OPPORTUNITY_STAGES.map((stage) => (
          <KanbanColumn
            key={stage}
            stage={stage}
            opportunities={stageGroups[stage] || []}
          />
        ))}
      </div>

      <DragOverlay>
        {activeOpp ? (
          <div className="drag-overlay">
            <OpportunityCard opportunity={activeOpp} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
