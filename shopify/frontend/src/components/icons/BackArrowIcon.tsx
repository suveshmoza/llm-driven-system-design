/**
 * Back arrow (chevron left) icon component.
 * Used for navigation back to previous views.
 *
 * @param props - Standard SVG element props
 * @returns SVG chevron left icon
 */
export function BackArrowIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
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
