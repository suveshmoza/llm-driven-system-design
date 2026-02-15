interface UserAvatarProps {
  avatarUrl: string | null;
  username: string;
  displayName?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeMap = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-12 h-12 text-lg',
  xl: 'w-20 h-20 text-2xl',
};

export default function UserAvatar({ avatarUrl, username, displayName, size = 'md', className = '' }: UserAvatarProps) {
  const letter = (displayName?.[0] || username[0]).toUpperCase();

  return (
    <div
      className={`rounded-full bg-gray-300 flex items-center justify-center font-bold text-white overflow-hidden shrink-0 ${sizeMap[size]} ${className}`}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={username} className="w-full h-full object-cover" />
      ) : (
        letter
      )}
    </div>
  );
}
