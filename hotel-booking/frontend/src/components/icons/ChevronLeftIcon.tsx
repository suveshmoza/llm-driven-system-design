/**
 * ChevronLeftIcon component.
 * Renders a left-pointing chevron SVG icon used for navigation and back buttons.
 *
 * @param props - Standard SVG element props
 * @returns A left-pointing chevron SVG icon
 *
 * @example
 * ```tsx
 * <ChevronLeftIcon className="w-4 h-4" />
 * ```
 */
export function ChevronLeftIcon(props: React.SVGProps<SVGSVGElement>) {
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
        d="M15 19l-7-7 7-7"
      />
    </svg>
  );
}
