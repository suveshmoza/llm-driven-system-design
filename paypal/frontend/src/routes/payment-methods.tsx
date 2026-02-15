import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { paymentMethodsApi } from '../services/api';
import type { PaymentMethod } from '../types';
import { PaymentMethodCard } from '../components/PaymentMethodCard';
import { AddPaymentMethodModal } from '../components/AddPaymentMethodModal';

function PaymentMethodsPage() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const navigate = useNavigate();

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: '/login' });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user) {
      loadMethods();
    }
  }, [user]);

  const loadMethods = async () => {
    setDataLoading(true);
    try {
      const res = await paymentMethodsApi.list();
      setMethods(res.paymentMethods);
    } catch {
      // handle error silently
    }
    setDataLoading(false);
  };

  const handleRemove = async (id: string) => {
    try {
      await paymentMethodsApi.remove(id);
      await loadMethods();
    } catch {
      // handle error
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await paymentMethodsApi.setDefault(id);
      await loadMethods();
    } catch {
      // handle error
    }
  };

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-paypal-secondary">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-paypal-text">Payment Methods</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-paypal-primary text-white rounded-lg hover:bg-paypal-hover text-sm font-medium"
        >
          + Add Method
        </button>
      </div>

      {dataLoading ? (
        <div className="text-center py-12 text-paypal-secondary">Loading...</div>
      ) : methods.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-paypal-border p-12 text-center">
          <p className="text-paypal-secondary mb-4">No payment methods added yet.</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-6 py-2 bg-paypal-primary text-white rounded-lg hover:bg-paypal-hover"
          >
            Add Your First Method
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {methods.map((method) => (
            <PaymentMethodCard
              key={method.id}
              method={method}
              onRemove={handleRemove}
              onSetDefault={handleSetDefault}
            />
          ))}
        </div>
      )}

      {showAddModal && (
        <AddPaymentMethodModal
          onClose={() => setShowAddModal(false)}
          onAdded={() => {
            setShowAddModal(false);
            loadMethods();
          }}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/payment-methods')({
  component: PaymentMethodsPage,
});
