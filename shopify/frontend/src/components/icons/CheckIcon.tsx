/**
 * Checkmark icon component.
 * Used for success states and confirmations.
 *
 * @param props - Standard SVG element props
 * @returns SVG checkmark icon
 */
export function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      className="w-8 h-8 text-white"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}
