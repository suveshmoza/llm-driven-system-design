import { createFileRoute } from '@tanstack/react-router';
import { useAuthStore } from '../stores/authStore';
import { ScheduleForm } from '../components/ScheduleForm';

export const Route = createFileRoute('/schedule')({
  component: SchedulePage,
});

function SchedulePage() {
  const { user } = useAuthStore();

  if (!user) return null;

  return (
    <div className="max-w-3xl mx-auto p-6 overflow-y-auto h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zoom-text">Schedule a Meeting</h1>
        <p className="text-zoom-secondary text-sm mt-1">Set up a new meeting for your team</p>
      </div>
      <ScheduleForm />
    </div>
  );
}
