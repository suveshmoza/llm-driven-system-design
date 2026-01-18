/**
 * Preference section components for the discovery preferences page.
 * Each component handles a specific preference setting.
 */
import type { UserPreferences } from '../../types';

/**
 * Props for preference section components.
 */
export interface PreferenceSectionProps {
  /** Current preferences */
  preferences: UserPreferences;
  /** Callback to update preferences */
  onChange: (updates: Partial<UserPreferences>) => void;
}

/**
 * Gender interest selection section.
 * Allows users to select which genders they want to see.
 * @param props - PreferenceSection props
 * @returns Gender selection buttons
 */
export function InterestedInSection({ preferences, onChange }: PreferenceSectionProps) {
  const toggleInterest = (gender: string) => {
    const interested_in = preferences.interested_in.includes(gender)
      ? preferences.interested_in.filter((g) => g !== gender)
      : [...preferences.interested_in, gender];

    if (interested_in.length === 0) return; // Must have at least one

    onChange({ interested_in });
  };

  return (
    <div className="card p-4">
      <h3 className="font-semibold mb-3">Show Me</h3>
      <div className="flex gap-2">
        {['male', 'female', 'other'].map((gender) => (
          <button
            key={gender}
            onClick={() => toggleInterest(gender)}
            className={`flex-1 py-2 rounded-full font-medium transition-colors ${
              preferences.interested_in.includes(gender)
                ? 'bg-tinder-gradient text-white'
                : 'bg-gray-200 text-gray-700'
            }`}
          >
            {gender.charAt(0).toUpperCase() + gender.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Age range selection section.
 * Allows users to set minimum and maximum age for matches.
 * @param props - PreferenceSection props
 * @returns Age range input fields
 */
export function AgeRangeSection({ preferences, onChange }: PreferenceSectionProps) {
  return (
    <div className="card p-4">
      <h3 className="font-semibold mb-3">Age Range</h3>
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label className="block text-sm text-gray-600 mb-1">Min Age</label>
          <input
            type="number"
            min={18}
            max={preferences.age_max}
            value={preferences.age_min}
            onChange={(e) =>
              onChange({ age_min: Math.max(18, parseInt(e.target.value) || 18) })
            }
            className="input text-center"
          />
        </div>
        <span className="text-gray-400 pt-6">-</span>
        <div className="flex-1">
          <label className="block text-sm text-gray-600 mb-1">Max Age</label>
          <input
            type="number"
            min={preferences.age_min}
            max={100}
            value={preferences.age_max}
            onChange={(e) =>
              onChange({ age_max: Math.min(100, parseInt(e.target.value) || 100) })
            }
            className="input text-center"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Distance slider section.
 * Allows users to set maximum distance for matches.
 * @param props - PreferenceSection props
 * @returns Distance slider with labels
 */
export function DistanceSection({ preferences, onChange }: PreferenceSectionProps) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Maximum Distance</h3>
        <span className="text-gradient-start font-medium">{preferences.distance_km} km</span>
      </div>
      <input
        type="range"
        min={1}
        max={500}
        value={preferences.distance_km}
        onChange={(e) => onChange({ distance_km: parseInt(e.target.value) })}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-gradient-start"
      />
      <div className="flex justify-between text-xs text-gray-500 mt-1">
        <span>1 km</span>
        <span>500 km</span>
      </div>
    </div>
  );
}

/**
 * Visibility toggle section.
 * Allows users to show/hide their profile in discovery.
 * @param props - PreferenceSection props
 * @returns Toggle switch with description
 */
export function VisibilitySection({ preferences, onChange }: PreferenceSectionProps) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Show Me in Discovery</h3>
          <p className="text-sm text-gray-500">Turn off to hide your profile</p>
        </div>
        <button
          onClick={() => onChange({ show_me: !preferences.show_me })}
          className={`w-12 h-6 rounded-full transition-colors ${
            preferences.show_me ? 'bg-tinder-gradient' : 'bg-gray-300'
          }`}
        >
          <div
            className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
              preferences.show_me ? 'translate-x-6' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
