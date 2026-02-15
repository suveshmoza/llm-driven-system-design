import { useState } from 'react';
import type { Account } from '../types';
import { useNavigate } from '@tanstack/react-router';

interface AccountListProps {
  accounts: Account[];
  total: number;
  loading: boolean;
  onSearch: (search: string) => void;
  onPageChange: (page: number) => void;
  page: number;
  onCreateClick: () => void;
}

function formatCurrency(cents: number | null): string {
  if (!cents) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

/** Renders a searchable, paginated table of accounts with clickable rows for detail navigation. */
export function AccountList({ accounts, total, loading, onSearch, onPageChange, page, onCreateClick }: AccountListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();
  const totalPages = Math.ceil(total / 20);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchTerm);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-salesforce-text">Accounts</h2>
        <button
          onClick={onCreateClick}
          className="px-4 py-2 bg-salesforce-primary text-white rounded-lg hover:bg-salesforce-hover text-sm font-medium"
        >
          New Account
        </button>
      </div>

      <form onSubmit={handleSearch} className="mb-4">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search accounts..."
          className="w-full px-4 py-2 border border-salesforce-border rounded-lg focus:outline-none focus:ring-2 focus:ring-salesforce-primary text-sm"
        />
      </form>

      <div className="bg-white rounded-lg shadow-sm border border-salesforce-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-salesforce-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Name</th>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Industry</th>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Phone</th>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Revenue</th>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Owner</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-salesforce-secondary">Loading...</td>
              </tr>
            ) : accounts.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-salesforce-secondary">No accounts found</td>
              </tr>
            ) : (
              accounts.map((account) => (
                <tr
                  key={account.id}
                  onClick={() => navigate({ to: '/accounts/$accountId', params: { accountId: account.id } })}
                  className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-salesforce-primary">{account.name}</td>
                  <td className="px-4 py-3 text-salesforce-text">{account.industry || '-'}</td>
                  <td className="px-4 py-3 text-salesforce-text">{account.phone || '-'}</td>
                  <td className="px-4 py-3 text-salesforce-text">{formatCurrency(account.annual_revenue_cents)}</td>
                  <td className="px-4 py-3 text-salesforce-secondary">{account.owner_name || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-salesforce-secondary">
            {total} accounts total
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1 text-sm border border-salesforce-border rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="px-3 py-1 text-sm text-salesforce-secondary">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1 text-sm border border-salesforce-border rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
