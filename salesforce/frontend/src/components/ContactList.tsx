import { useState } from 'react';
import type { Contact } from '../types';

interface ContactListProps {
  contacts: Contact[];
  total: number;
  loading: boolean;
  onSearch: (search: string) => void;
  onPageChange: (page: number) => void;
  page: number;
  onCreateClick: () => void;
}

/** Renders a searchable, paginated table of contacts with account association. */
export function ContactList({ contacts, total, loading, onSearch, onPageChange, page, onCreateClick }: ContactListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const totalPages = Math.ceil(total / 20);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchTerm);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-salesforce-text">Contacts</h2>
        <button
          onClick={onCreateClick}
          className="px-4 py-2 bg-salesforce-primary text-white rounded-lg hover:bg-salesforce-hover text-sm font-medium"
        >
          New Contact
        </button>
      </div>

      <form onSubmit={handleSearch} className="mb-4">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search contacts..."
          className="w-full px-4 py-2 border border-salesforce-border rounded-lg focus:outline-none focus:ring-2 focus:ring-salesforce-primary text-sm"
        />
      </form>

      <div className="bg-white rounded-lg shadow-sm border border-salesforce-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-salesforce-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Name</th>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Title</th>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Account</th>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Email</th>
              <th className="text-left px-4 py-3 font-medium text-salesforce-secondary">Phone</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-salesforce-secondary">Loading...</td>
              </tr>
            ) : contacts.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-salesforce-secondary">No contacts found</td>
              </tr>
            ) : (
              contacts.map((contact) => (
                <tr
                  key={contact.id}
                  className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-salesforce-primary">
                    {contact.first_name} {contact.last_name}
                  </td>
                  <td className="px-4 py-3 text-salesforce-text">{contact.title || '-'}</td>
                  <td className="px-4 py-3 text-salesforce-text">{contact.account_name || '-'}</td>
                  <td className="px-4 py-3 text-salesforce-text">{contact.email || '-'}</td>
                  <td className="px-4 py-3 text-salesforce-text">{contact.phone || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-salesforce-secondary">{total} contacts total</span>
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
