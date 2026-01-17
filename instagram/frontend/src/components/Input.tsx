import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-text-primary mb-1">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`w-full px-3 py-2 border border-border-gray rounded bg-gray-bg text-sm
            focus:outline-none focus:border-text-secondary placeholder-text-secondary
            ${error ? 'border-like-red' : ''} ${className}`}
          {...props}
        />
        {error && <p className="mt-1 text-sm text-like-red">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
