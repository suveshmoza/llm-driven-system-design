import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useCrmStore } from '../stores/crmStore';
import { ContactList } from '../components/ContactList';
import { EntityForm } from '../components/EntityForm';
import { contactsApi, accountsApi } from '../services/api';

function ContactsPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { contacts, contactsTotal, contactsLoading, fetchContacts } = useCrmStore();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [accountOptions, setAccountOptions] = useState<{ id: string; name: string }[]>([]);

  const loadContacts = useCallback((search?: string, p?: number) => {
    fetchContacts({ search, page: p || page });
  }, [fetchContacts, page]);

  useEffect(() => {
    if (!user) {
      navigate({ to: '/login' });
      return;
    }
    loadContacts();
  }, [user, navigate, loadContacts]);

  const loadAccountOptions = async () => {
    const data = await accountsApi.list({ limit: 100 });
    setAccountOptions(data.accounts.map((a) => ({ id: a.id, name: a.name })));
  };

  if (!user) return null;

  const handleSearch = (search: string) => {
    setPage(1);
    loadContacts(search, 1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchContacts({ page: newPage });
  };

  const handleCreate = async (data: Record<string, unknown>) => {
    await contactsApi.create(data);
    setShowForm(false);
    loadContacts();
  };

  const handleShowForm = async () => {
    await loadAccountOptions();
    setShowForm(true);
  };

  return (
    <div className="p-6">
      <ContactList
        contacts={contacts}
        total={contactsTotal}
        loading={contactsLoading}
        onSearch={handleSearch}
        onPageChange={handlePageChange}
        page={page}
        onCreateClick={handleShowForm}
      />

      {showForm && (
        <EntityForm
          entityType="contact"
          onSave={handleCreate}
          onCancel={() => setShowForm(false)}
          accounts={accountOptions}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/contacts')({
  component: ContactsPage,
});
