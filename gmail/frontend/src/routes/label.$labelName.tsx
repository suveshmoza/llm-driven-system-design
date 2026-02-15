import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useMailStore } from '../stores/mailStore';
import { ThreadList } from '../components/ThreadList';

export const Route = createFileRoute('/label/$labelName')({
  component: LabelPage,
});

function LabelPage() {
  const { labelName } = Route.useParams();
  const { fetchThreads, setCurrentLabel, fetchUnreadCounts } = useMailStore();

  useEffect(() => {
    setCurrentLabel(labelName);
    fetchThreads(labelName, 1);
    fetchUnreadCounts();
  }, [labelName, fetchThreads, setCurrentLabel, fetchUnreadCounts]);

  return <ThreadList />;
}
