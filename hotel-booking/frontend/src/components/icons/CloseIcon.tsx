/**
 * CloseIcon component.
 * Renders an X-shaped close/dismiss SVG icon used for closing modals, alerts, and dialogs.
 *
 * @param props - Standard SVG element props
 * @returns An X-shaped close SVG icon
 *
 * @example
 * ```tsx
 * <CloseIcon className="w-6 h-6" />
 * ```
 */
export function CloseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}
