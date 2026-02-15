import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';

export const Route = createFileRoute('/')({
  component: IndexPage,
});

function IndexPage() {
  const { isAuthenticated } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      navigate({ to: '/label/$labelName', params: { labelName: 'INBOX' } });
    } else {
      navigate({ to: '/login' });
    }
  }, [isAuthenticated, navigate]);

  return null;
}
