/**
 * Admin dashboard sub-components.
 * Extracted from admin.tsx for better maintainability.
 */

/**
 * Props for the StatCard component.
 */
export interface StatCardProps {
  /** Label for the statistic */
  title: string;
  /** Main value to display */
  value: number | string;
  /** Additional context or comparison */
  subtitle: string;
}

/**
 * Reusable statistics card component for the admin dashboard.
 * Displays a metric with title, value, and subtitle.
 * @param props - StatCard props
 * @returns Stat card element
 */
export function StatCard({ title, value, subtitle }: StatCardProps) {
  return (
    <div className="card p-4">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-2xl font-bold text-gradient-start">{value}</p>
      <p className="text-xs text-gray-400">{subtitle}</p>
    </div>
  );
}

/**
 * Props for the GenderDistribution component.
 */
export interface GenderDistributionProps {
  /** Number of male users */
  maleCount: number;
  /** Number of female users */
  femaleCount: number;
  /** Total number of users */
  total: number;
}

/**
 * Gender distribution visualization card.
 * Shows male/female ratio with progress bars.
 * @param props - GenderDistribution props
 * @returns Gender distribution card element
 */
export function GenderDistribution({ maleCount, femaleCount, total }: GenderDistributionProps) {
  return (
    <div className="card p-4">
      <h3 className="font-semibold mb-3">Gender Distribution</h3>
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="flex justify-between text-sm mb-1">
            <span>Male</span>
            <span>{maleCount}</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500"
              style={{ width: `${(maleCount / total) * 100}%` }}
            />
          </div>
        </div>
        <div className="flex-1">
          <div className="flex justify-between text-sm mb-1">
            <span>Female</span>
            <span>{femaleCount}</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-pink-500"
              style={{ width: `${(femaleCount / total) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Props for the MessagingStats component.
 */
export interface MessagingStatsProps {
  /** Total number of messages sent */
  totalMessages: number;
  /** Messages sent today */
  messagesToday: number;
  /** Average messages per match */
  avgMessagesPerMatch: number;
}

/**
 * Messaging statistics card.
 * Shows total messages, today's count, and average per match.
 * @param props - MessagingStats props
 * @returns Messaging stats card element
 */
export function MessagingStats({ totalMessages, messagesToday, avgMessagesPerMatch }: MessagingStatsProps) {
  return (
    <div className="card p-4">
      <h3 className="font-semibold mb-3">Messaging</h3>
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-2xl font-bold text-gradient-start">{totalMessages}</p>
          <p className="text-sm text-gray-500">Total Messages</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-gradient-start">{messagesToday}</p>
          <p className="text-sm text-gray-500">Today</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-gradient-start">{avgMessagesPerMatch.toFixed(1)}</p>
          <p className="text-sm text-gray-500">Avg/Match</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Recent signup entry type.
 */
export interface RecentSignup {
  id: string;
  name: string;
  email: string;
  created_at: string;
  gender: string;
}

/**
 * Props for the RecentSignups component.
 */
export interface RecentSignupsProps {
  /** List of recent signups */
  signups: RecentSignup[];
}

/**
 * Recent signups list card.
 * Shows new user registrations with gender badges.
 * @param props - RecentSignups props
 * @returns Recent signups card element
 */
export function RecentSignups({ signups }: RecentSignupsProps) {
  return (
    <div className="card p-4">
      <h3 className="font-semibold mb-3">Recent Signups</h3>
      <div className="space-y-2">
        {signups.map((signup) => (
          <div
            key={signup.id}
            className="flex items-center justify-between py-2 border-b last:border-0"
          >
            <div>
              <p className="font-medium">{signup.name}</p>
              <p className="text-sm text-gray-500">{signup.email}</p>
            </div>
            <div className="text-right">
              <span
                className={`text-xs px-2 py-1 rounded-full ${
                  signup.gender === 'male'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-pink-100 text-pink-700'
                }`}
              >
                {signup.gender}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Recent match entry type.
 */
export interface RecentMatch {
  id: string;
  matched_at: string;
  user1_name: string;
  user2_name: string;
}

/**
 * Props for the RecentMatches component.
 */
export interface RecentMatchesProps {
  /** List of recent matches */
  matches: RecentMatch[];
}

/**
 * Recent matches list card.
 * Shows new matches with heart icon and date.
 * @param props - RecentMatches props
 * @returns Recent matches card element
 */
export function RecentMatches({ matches }: RecentMatchesProps) {
  return (
    <div className="card p-4">
      <h3 className="font-semibold mb-3">Recent Matches</h3>
      <div className="space-y-2">
        {matches.map((match) => (
          <div
            key={match.id}
            className="flex items-center justify-between py-2 border-b last:border-0"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{match.user1_name}</span>
              <svg className="w-4 h-4 text-gradient-start" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
              <span className="font-medium">{match.user2_name}</span>
            </div>
            <span className="text-sm text-gray-500">
              {new Date(match.matched_at).toLocaleDateString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
