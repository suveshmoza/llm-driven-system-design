import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useMailStore } from '../stores/mailStore';
import { ThreadView } from '../components/ThreadView';

export const Route = createFileRoute('/thread/$threadId')({
  component: ThreadPage,
});

function ThreadPage() {
  const { threadId } = Route.useParams();
  const navigate = useNavigate();
  const { fetchThread, currentThread, clearCurrentThread, currentLabel } =
    useMailStore();

  useEffect(() => {
    fetchThread(threadId);
    return () => clearCurrentThread();
  }, [threadId, fetchThread, clearCurrentThread]);

  const handleBack = () => {
    navigate({
      to: '/label/$labelName',
      params: { labelName: currentLabel },
    });
  };

  if (!currentThread) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gmail-text-secondary">Loading...</div>
      </div>
    );
  }

  return <ThreadView thread={currentThread} onBack={handleBack} />;
}
