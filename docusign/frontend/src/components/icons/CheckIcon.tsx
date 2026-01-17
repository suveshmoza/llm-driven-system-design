/**
 * Checkmark icon component.
 * Displays a checkmark symbol, typically used to indicate completion or success.
 *
 * @param props - Standard SVG element props
 * @returns An SVG element representing a checkmark
 */
export function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20" {...props}>
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}
