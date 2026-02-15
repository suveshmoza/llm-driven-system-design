import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useCrmStore } from '../stores/crmStore';
import { LeadList } from '../components/LeadList';
import { EntityForm } from '../components/EntityForm';
import { ConvertLeadModal } from '../components/ConvertLeadModal';
import { leadsApi } from '../services/api';
import type { Lead } from '../types';

function LeadsPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { leads, leadsTotal, leadsLoading, fetchLeads } = useCrmStore();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [convertingLead, setConvertingLead] = useState<Lead | null>(null);

  const loadLeads = useCallback((search?: string, status?: string, source?: string, p?: number) => {
    fetchLeads({ search, status, source, page: p || page });
  }, [fetchLeads, page]);

  useEffect(() => {
    if (!user) {
      navigate({ to: '/login' });
      return;
    }
    loadLeads();
  }, [user, navigate, loadLeads]);

  if (!user) return null;

  const handleSearch = (search: string) => {
    setPage(1);
    loadLeads(search, undefined, undefined, 1);
  };

  const handleFilter = (status?: string, source?: string) => {
    setPage(1);
    loadLeads(undefined, status, source, 1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchLeads({ page: newPage });
  };

  const handleCreate = async (data: Record<string, unknown>) => {
    await leadsApi.create(data);
    setShowForm(false);
    loadLeads();
  };

  const handleConverted = () => {
    setConvertingLead(null);
    loadLeads();
  };

  return (
    <div className="p-6">
      <LeadList
        leads={leads}
        total={leadsTotal}
        loading={leadsLoading}
        onSearch={handleSearch}
        onFilter={handleFilter}
        onPageChange={handlePageChange}
        page={page}
        onCreateClick={() => setShowForm(true)}
        onConvertClick={setConvertingLead}
      />

      {showForm && (
        <EntityForm
          entityType="lead"
          onSave={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {convertingLead && (
        <ConvertLeadModal
          lead={convertingLead}
          onConverted={handleConverted}
          onCancel={() => setConvertingLead(null)}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/leads')({
  component: LeadsPage,
});
