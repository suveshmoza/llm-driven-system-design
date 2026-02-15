import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { walletApi, transfersApi, requestsApi } from '../services/api';
import type { Wallet, Transaction, TransferRequest } from '../types';
import { WalletCard } from '../components/WalletCard';
import { TransactionList } from '../components/TransactionList';
import { RequestCard } from '../components/RequestCard';
import { QuickActions } from '../components/QuickActions';

function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const navigate = useNavigate();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pendingRequests, setPendingRequests] = useState<TransferRequest[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: '/login' });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  const loadData = async () => {
    setDataLoading(true);
    try {
      const [walletRes, txRes, reqRes] = await Promise.all([
        walletApi.get(),
        transfersApi.list(),
        requestsApi.list('incoming', 'pending'),
      ]);
      setWallet(walletRes.wallet);
      setTransactions(txRes.transactions.slice(0, 5));
      setPendingRequests(reqRes.requests);
    } catch {
      // handle error silently
    }
    setDataLoading(false);
  };

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-paypal-secondary">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-paypal-text mb-6">
        Welcome, {user.username}
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          <WalletCard wallet={wallet} loading={dataLoading} onRefresh={loadData} />
          <QuickActions />

          {/* Pending Requests */}
          {pendingRequests.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-paypal-border p-6">
              <h2 className="text-lg font-semibold text-paypal-text mb-4">
                Pending Requests
              </h2>
              <div className="space-y-3">
                {pendingRequests.map((req) => (
                  <RequestCard
                    key={req.id}
                    request={req}
                    currentUserId={user.id}
                    onAction={loadData}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div>
          <div className="bg-white rounded-xl shadow-sm border border-paypal-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-paypal-text">Recent Activity</h2>
              <button
                onClick={() => navigate({ to: '/activity' })}
                className="text-sm text-paypal-primary hover:underline"
              >
                View all
              </button>
            </div>
            <TransactionList
              transactions={transactions}
              currentUserId={user.id}
              loading={dataLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: DashboardPage,
});
