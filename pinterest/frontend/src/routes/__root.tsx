import { createFileRoute, Outlet } from '@tanstack/react-router';
import Header from '../components/Header';

export const Route = createFileRoute('__root')({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main className="pt-[64px]">
        <Outlet />
      </main>
    </div>
  );
}
