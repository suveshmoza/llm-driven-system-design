import type { Organization } from '../types';

interface OrgSelectorProps {
  organizations: Organization[];
  currentOrgId: string | null;
  onSelect: (orgId: string) => void;
}

/** Vertical organization icon selector with active state highlighting. */
export function OrgSelector({ organizations, currentOrgId, onSelect }: OrgSelectorProps) {
  return (
    <div className="flex flex-col items-center gap-1">
      {organizations.map((org) => (
        <button
          key={org.id}
          onClick={() => onSelect(org.id)}
          className={`w-12 h-12 rounded-xl flex items-center justify-center text-sm font-bold transition-all ${
            currentOrgId === org.id
              ? 'bg-teams-primary text-white rounded-2xl'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:rounded-xl'
          }`}
          title={org.name}
        >
          {org.name.charAt(0).toUpperCase()}
        </button>
      ))}
    </div>
  );
}
