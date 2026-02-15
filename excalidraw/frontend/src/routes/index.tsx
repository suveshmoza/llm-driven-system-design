import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Header } from '../components/Header';
import { DrawingList } from '../components/DrawingList';

export const Route = createFileRoute('/')({
  component: DashboardPage,
});

function DashboardPage() {
  const navigate = useNavigate();

  const handleSelectDrawing = (drawingId: string) => {
    navigate({ to: '/draw/$drawingId', params: { drawingId } });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <DrawingList onSelectDrawing={handleSelectDrawing} />
      </main>
    </div>
  );
}
