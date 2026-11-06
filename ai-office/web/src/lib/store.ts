import { create } from 'zustand';
import { api, type Agent, type AgentId, type AgentState, type Campaign, type CampaignDetail, type SystemInfo, type User } from './api';

export type Tab = 'campaigns' | 'topics' | 'approval' | 'assets' | 'reports' | 'integrations' | 'workflows' | 'logs' | 'users';

export interface Handoff { id: number; from: AgentId; to: AgentId; label: string; at: number }

interface State {
  user: User | null;
  needsBootstrap: boolean;
  authChecked: boolean;
  system: SystemInfo | null;
  agents: Agent[];
  campaigns: Campaign[];
  selectedCampaignId: string | null;
  detail: CampaignDetail | null;
  selectedAgent: AgentId | null;
  tab: Tab;
  theme: 'light' | 'dark';
  handoffs: Handoff[];
  connected: boolean;
  toast: { kind: 'ok' | 'err'; text: string } | null;
  logVersion: number;

  checkAuth(): Promise<void>;
  loadAll(): Promise<void>;
  loadCampaigns(): Promise<void>;
  selectCampaign(id: string | null): Promise<void>;
  refreshDetail(): Promise<void>;
  setTab(t: Tab): void;
  selectAgent(a: AgentId | null): void;
  toggleTheme(): void;
  notify(kind: 'ok' | 'err', text: string): void;
  connect(): () => void;
}

const initialTheme = (): 'light' | 'dark' => {
  try {
    const t = localStorage.getItem('aio-theme');
    if (t === 'dark' || t === 'light') return t;
  } catch { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

let handoffSeq = 0;
let refreshTimer: number | null = null;
let listTimer: number | null = null;

export const useStore = create<State>((set, get) => ({
  user: null,
  needsBootstrap: false,
  authChecked: false,
  system: null,
  agents: [],
  campaigns: [],
  selectedCampaignId: null,
  detail: null,
  selectedAgent: null,
  tab: 'campaigns',
  theme: initialTheme(),
  handoffs: [],
  connected: false,
  toast: null,
  logVersion: 0,

  async checkAuth() {
    const s = await api.get<{ needsBootstrap: boolean; user: User | null }>('/api/auth/status');
    set({ user: s.user, needsBootstrap: s.needsBootstrap, authChecked: true });
  },

  async loadAll() {
    const [system, agents] = await Promise.all([api.get<SystemInfo>('/api/system'), api.get<Agent[]>('/api/agents')]);
    set({ system, agents });
    await get().loadCampaigns();
    const first = get().campaigns[0];
    if (!get().selectedCampaignId && first) await get().selectCampaign(first.id);
  },

  async loadCampaigns() {
    set({ campaigns: await api.get<Campaign[]>('/api/campaigns') });
  },

  async selectCampaign(id) {
    set({ selectedCampaignId: id, detail: null });
    if (id) set({ detail: await api.get<CampaignDetail>(`/api/campaigns/${id}`) });
  },

  async refreshDetail() {
    const id = get().selectedCampaignId;
    if (!id) return;
    try {
      const d = await api.get<CampaignDetail>(`/api/campaigns/${id}`);
      if (get().selectedCampaignId === id) set({ detail: d });
    } catch { /* deleted */ }
  },

  setTab: (tab) => set({ tab }),
  selectAgent: (selectedAgent) => set({ selectedAgent }),
  toggleTheme() {
    const theme = get().theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('aio-theme', theme); } catch { /* ignore */ }
    set({ theme });
  },
  notify(kind, text) {
    set({ toast: { kind, text } });
    window.setTimeout(() => get().toast?.text === text && set({ toast: null }), 4500);
  },

  connect() {
    const es = new EventSource('/api/events');
    const scheduleDetail = () => {
      if (refreshTimer) return;
      refreshTimer = window.setTimeout(() => { refreshTimer = null; void get().refreshDetail(); }, 250);
    };
    const scheduleList = () => {
      if (listTimer) return;
      listTimer = window.setTimeout(() => { listTimer = null; void get().loadCampaigns(); }, 400);
    };
    es.onopen = () => set({ connected: true });
    es.onerror = () => set({ connected: false });
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      switch (e.type) {
        case 'agent':
          set({ agents: get().agents.map((a) => (a.id === e.agent ? { ...a, state: e.state as AgentState } : a)) });
          break;
        case 'handoff': {
          const h: Handoff = { id: ++handoffSeq, from: e.from, to: e.to, label: e.label, at: Date.now() };
          set({ handoffs: [...get().handoffs.filter((x) => Date.now() - x.at < 6000), h] });
          break;
        }
        case 'task':
        case 'content':
        case 'publication':
          if (e.campaignId === get().selectedCampaignId) scheduleDetail();
          if (e.type === 'task') scheduleList();
          break;
        case 'campaign':
          scheduleList();
          if (e.campaignId === get().selectedCampaignId) scheduleDetail();
          break;
        case 'log':
          set({ logVersion: get().logVersion + 1 });
          break;
      }
    };
    return () => es.close();
  },
}));
