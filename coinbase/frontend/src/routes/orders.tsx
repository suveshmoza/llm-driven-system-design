import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { usePortfolioStore } from '../stores/portfolioStore';
import { OrderHistory } from '../components/OrderHistory';

function OrdersPage() {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const navigate = useNavigate();

  const orders = usePortfolioStore((s) => s.orders);
  const fetchOrders = usePortfolioStore((s) => s.fetchOrders);
  const cancelOrder = usePortfolioStore((s) => s.cancelOrder);

  useEffect(() => {
    if (!isLoading && !user) {
      navigate({ to: '/login' });
    }
  }, [user, isLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchOrders();
    }
  }, [user, fetchOrders]);

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cb-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Orders</h1>
      <OrderHistory orders={orders} onCancel={cancelOrder} />
    </div>
  );
}

export const Route = createFileRoute('/orders')({
  component: OrdersPage,
});
