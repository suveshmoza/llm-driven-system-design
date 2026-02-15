import { createFileRoute } from '@tanstack/react-router';
import CreatePin from '../components/CreatePin';
import { useAuthStore } from '../stores/authStore';
import { Link } from '@tanstack/react-router';

export const Route = createFileRoute('/create')({
  component: CreatePage,
});

function CreatePage() {
  const { user } = useAuthStore();

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4">
        <h2 className="text-2xl font-bold mb-4">Log in to create Pins</h2>
        <p className="text-text-secondary mb-6">Share your ideas with the world</p>
        <Link to="/login" className="btn-pinterest">
          Log in
        </Link>
      </div>
    );
  }

  return <CreatePin />;
}
