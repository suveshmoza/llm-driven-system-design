import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { AccountDetail } from '../components/AccountDetail';

function AccountDetailPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { accountId } = Route.useParams();

  useEffect(() => {
    if (!user) {
      navigate({ to: '/login' });
    }
  }, [user, navigate]);

  if (!user) return null;

  return (
    <div className="p-6">
      <button
        onClick={() => navigate({ to: '/accounts' })}
        className="text-sm text-salesforce-primary hover:underline mb-4 inline-block"
      >
        &larr; Back to Accounts
      </button>
      <AccountDetail accountId={accountId} />
    </div>
  );
}

export const Route = createFileRoute('/accounts/$accountId')({
  component: AccountDetailPage,
});
