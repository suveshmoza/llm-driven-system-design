import { create } from 'zustand';
import type {
  Account, Contact, Opportunity, Lead, Activity,
  DashboardKPIs, PipelineStage, RevenueByMonth, LeadsBySource,
} from '../types';
import {
  dashboardApi, accountsApi, contactsApi, opportunitiesApi,
  leadsApi, activitiesApi, reportsApi,
} from '../services/api';

interface CrmState {
  // Dashboard
  kpis: DashboardKPIs | null;
  kpisLoading: boolean;
  fetchKPIs: () => Promise<void>;

  // Accounts
  accounts: Account[];
  accountsTotal: number;
  accountsLoading: boolean;
  fetchAccounts: (params?: { search?: string; industry?: string; page?: number }) => Promise<void>;

  // Contacts
  contacts: Contact[];
  contactsTotal: number;
  contactsLoading: boolean;
  fetchContacts: (params?: { search?: string; accountId?: string; page?: number }) => Promise<void>;

  // Opportunities
  opportunities: Opportunity[];
  opportunitiesTotal: number;
  opportunitiesLoading: boolean;
  fetchOpportunities: (params?: { search?: string; stage?: string; accountId?: string; page?: number; limit?: number }) => Promise<void>;
  updateOpportunityStage: (id: string, stage: string) => Promise<void>;

  // Leads
  leads: Lead[];
  leadsTotal: number;
  leadsLoading: boolean;
  fetchLeads: (params?: { search?: string; status?: string; source?: string; page?: number }) => Promise<void>;

  // Activities
  activities: Activity[];
  activitiesTotal: number;
  activitiesLoading: boolean;
  fetchActivities: (params?: { relatedType?: string; relatedId?: string; completed?: boolean; page?: number }) => Promise<void>;

  // Reports
  pipeline: PipelineStage[];
  revenue: RevenueByMonth[];
  leadsBySource: LeadsBySource[];
  reportsLoading: boolean;
  fetchPipelineReport: (all?: boolean) => Promise<void>;
  fetchRevenueReport: (months?: number, all?: boolean) => Promise<void>;
  fetchLeadsReport: (all?: boolean) => Promise<void>;
}

/** Centralized CRM state managing accounts, contacts, opportunities, leads, activities, and reports. */
export const useCrmStore = create<CrmState>((set) => ({
  // Dashboard
  kpis: null,
  kpisLoading: false,
  fetchKPIs: async () => {
    set({ kpisLoading: true });
    try {
      const { kpis } = await dashboardApi.getKPIs();
      set({ kpis, kpisLoading: false });
    } catch {
      set({ kpisLoading: false });
    }
  },

  // Accounts
  accounts: [],
  accountsTotal: 0,
  accountsLoading: false,
  fetchAccounts: async (params) => {
    set({ accountsLoading: true });
    try {
      const data = await accountsApi.list(params);
      set({ accounts: data.accounts, accountsTotal: data.total, accountsLoading: false });
    } catch {
      set({ accountsLoading: false });
    }
  },

  // Contacts
  contacts: [],
  contactsTotal: 0,
  contactsLoading: false,
  fetchContacts: async (params) => {
    set({ contactsLoading: true });
    try {
      const data = await contactsApi.list(params);
      set({ contacts: data.contacts, contactsTotal: data.total, contactsLoading: false });
    } catch {
      set({ contactsLoading: false });
    }
  },

  // Opportunities
  opportunities: [],
  opportunitiesTotal: 0,
  opportunitiesLoading: false,
  fetchOpportunities: async (params) => {
    set({ opportunitiesLoading: true });
    try {
      const data = await opportunitiesApi.list(params);
      set({ opportunities: data.opportunities, opportunitiesTotal: data.total, opportunitiesLoading: false });
    } catch {
      set({ opportunitiesLoading: false });
    }
  },
  updateOpportunityStage: async (id, stage) => {
    try {
      const { opportunity } = await opportunitiesApi.updateStage(id, stage);
      set((state) => ({
        opportunities: state.opportunities.map((o) =>
          o.id === id ? { ...o, stage: opportunity.stage, probability: opportunity.probability } : o,
        ),
      }));
    } catch {
      // re-fetch on error
    }
  },

  // Leads
  leads: [],
  leadsTotal: 0,
  leadsLoading: false,
  fetchLeads: async (params) => {
    set({ leadsLoading: true });
    try {
      const data = await leadsApi.list(params);
      set({ leads: data.leads, leadsTotal: data.total, leadsLoading: false });
    } catch {
      set({ leadsLoading: false });
    }
  },

  // Activities
  activities: [],
  activitiesTotal: 0,
  activitiesLoading: false,
  fetchActivities: async (params) => {
    set({ activitiesLoading: true });
    try {
      const data = await activitiesApi.list(params);
      set({ activities: data.activities, activitiesTotal: data.total, activitiesLoading: false });
    } catch {
      set({ activitiesLoading: false });
    }
  },

  // Reports
  pipeline: [],
  revenue: [],
  leadsBySource: [],
  reportsLoading: false,
  fetchPipelineReport: async (all) => {
    set({ reportsLoading: true });
    try {
      const { pipeline } = await reportsApi.pipeline(all);
      set({ pipeline, reportsLoading: false });
    } catch {
      set({ reportsLoading: false });
    }
  },
  fetchRevenueReport: async (months, all) => {
    set({ reportsLoading: true });
    try {
      const { revenue } = await reportsApi.revenue(months, all);
      set({ revenue, reportsLoading: false });
    } catch {
      set({ reportsLoading: false });
    }
  },
  fetchLeadsReport: async (all) => {
    set({ reportsLoading: true });
    try {
      const { leads } = await reportsApi.leads(all);
      set({ leadsBySource: leads, reportsLoading: false });
    } catch {
      set({ reportsLoading: false });
    }
  },
}));
