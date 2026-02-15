import { useState } from 'react';
import type { Lead } from '../types';
import { StatusBadge } from './StatusBadge';
import { LEAD_STATUSES, LEAD_SOURCES } from '../types';

interface LeadListProps {
  leads: Lead[];
  total: number;
  loading: boolean;
  onSearch: (search: string) => void;
  onFilter: (status?: string, source?: string) => void;
  onPageChange: (page: number) => void;
  page: number;
  onCreateClick: () => void;
  onConvertClick: (lead: Lead) => void;
}

/** Renders a filterable, paginated lead table with status/source filters and convert action buttons. */
export function LeadList({
  leads, total, loading, onSearch, onFilter,
  onPageChange, page, onCreateClick, onConvertClick,
}: LeadListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const totalPages = Math.ceil(total / 20);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchTerm);
  };

  const handleFilter = (status: string, source: string) => {
    setStatusFilter(status);
    setSourceFilter(source);
    onFilter(status || undefined, source || undefined);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-salesforce-text">Leads</h2>
        <button
          onClick={onCreateClick}
          className="px-4 py-2 bg-salesforce-primary text-white rounded-lg hover:bg-salesforce-hover text-sm font-medium"
        >
          New Lead
        </button>
      </div>

      <div className="flex gap-3 mb-4">
        <form onSubmit={handleSearch} className="flex-1">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search leads..."
            className="w-full px-4 py-2 border border-salesforce-border rounded-lg focus:outline-none focus:ring-2 focus:ring-salesforce-primary text-sm"
          />
        </form>
        <select
          value={statusFilter}
          onChange={(e) => handleFilter(e.target.value, sourceFilter)}
          className="px-3 py-2 border border-salesforce-border rounded-lg text-sm"
        >
          <option value="">All Statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => handleFilter(statusFilter, e.target.value)}
          className="px-3 py-2 border border-salesforce-border rounded-lg text-sm"
        >
          <option value="">All Sources</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-salesforce-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-salesforce-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Name</th>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Company</th>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Source</th>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Status</th>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Owner</th>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-salesforce-secondary">Loading...</td>
              </tr>
            ) : leads.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-salesforce-secondary">No leads found</td>
              </tr>
            ) : (
              leads.map((lead) => (
                <tr key={lead.id} className="border-b border-gray-100 hover:bg-blue-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-salesforce-primary">
                    {lead.first_name} {lead.last_name}
                  </td>
                  <td className="px-4 py-3 text-salesforce-text">{lead.company || '-'}</td>
                  <td className="px-4 py-3 text-salesforce-text">{lead.source || '-'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={lead.status} type="lead" />
                  </td>
                  <td className="px-4 py-3 text-salesforce-secondary">{lead.owner_name || '-'}</td>
                  <td className="px-4 py-3">
                    {lead.status !== 'Converted' && (
                      <button
                        onClick={() => onConvertClick(lead)}
                        className="px-3 py-1 bg-salesforce-success text-white rounded text-xs hover:bg-green-700"
                      >
                        Convert
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-salesforce-secondary">{total} leads total</span>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1 text-sm border border-salesforce-border rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="px-3 py-1 text-sm text-salesforce-secondary">Page {page} of {totalPages}</span>
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
