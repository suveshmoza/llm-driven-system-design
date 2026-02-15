import { useState } from 'react';
import type { Lead } from '../types';
import { leadsApi } from '../services/api';

interface ConvertLeadModalProps {
  lead: Lead;
  onConverted: () => void;
  onCancel: () => void;
}

/** Renders a modal dialog for converting a lead into an account, contact, and optional opportunity. */
export function ConvertLeadModal({ lead, onConverted, onCancel }: ConvertLeadModalProps) {
  const [accountName, setAccountName] = useState(lead.company || `${lead.first_name} ${lead.last_name}`);
  const [opportunityName, setOpportunityName] = useState(`${lead.company || lead.last_name} - New Opportunity`);
  const [createOpportunity, setCreateOpportunity] = useState(true);
  const [opportunityAmount, setOpportunityAmount] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      await leadsApi.convert(lead.id, {
        accountName,
        opportunityName: createOpportunity ? opportunityName : undefined,
        opportunityAmount: createOpportunity && opportunityAmount ? parseFloat(opportunityAmount) : undefined,
        closeDate: createOpportunity && closeDate ? closeDate : undefined,
      });
      onConverted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold text-salesforce-text mb-2">Convert Lead</h3>
        <p className="text-sm text-salesforce-secondary mb-4">
          Converting <strong>{lead.first_name} {lead.last_name}</strong> from {lead.company || 'Unknown Company'}
        </p>

        {error && (
          <div className="bg-red-50 text-red-600 px-3 py-2 rounded text-sm mb-4">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-salesforce-text mb-1">Account Name</label>
            <input
              type="text"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-salesforce-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-salesforce-primary"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="createOpp"
              checked={createOpportunity}
              onChange={(e) => setCreateOpportunity(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="createOpp" className="text-sm text-salesforce-text">Create Opportunity</label>
          </div>

          {createOpportunity && (
            <>
              <div>
                <label className="block text-sm font-medium text-salesforce-text mb-1">Opportunity Name</label>
                <input
                  type="text"
                  value={opportunityName}
                  onChange={(e) => setOpportunityName(e.target.value)}
                  className="w-full px-3 py-2 border border-salesforce-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-salesforce-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-salesforce-text mb-1">Amount ($)</label>
                  <input
                    type="number"
                    value={opportunityAmount}
                    onChange={(e) => setOpportunityAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-salesforce-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-salesforce-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-salesforce-text mb-1">Close Date</label>
                  <input
                    type="date"
                    value={closeDate}
                    onChange={(e) => setCloseDate(e.target.value)}
                    className="w-full px-3 py-2 border border-salesforce-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-salesforce-primary"
                  />
                </div>
              </div>
            </>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-salesforce-border rounded-lg text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-salesforce-success text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {submitting ? 'Converting...' : 'Convert Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
