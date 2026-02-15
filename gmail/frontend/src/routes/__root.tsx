import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '../stores/authStore';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { ComposeModal } from '../components/ComposeModal';
import { useMailStore } from '../stores/mailStore';

function RootLayout() {
  const { isAuthenticated, isLoading } = useAuthStore();
  const { composeOpen, setComposeOpen } = useMailStore();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gmail-bg flex items-center justify-center">
        <div className="text-gmail-text-secondary text-lg">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Show login page via outlet
    return (
      <div className="min-h-screen bg-gmail-bg">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gmail-bg flex flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          onCompose={() => setComposeOpen(true)}
          onNavigate={(label) => navigate({ to: '/label/$labelName', params: { labelName: label } })}
        />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      {composeOpen && (
        <ComposeModal onClose={() => setComposeOpen(false)} />
      )}
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
