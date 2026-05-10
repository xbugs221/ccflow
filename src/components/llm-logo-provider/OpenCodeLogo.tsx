// PURPOSE: Render the OpenCode provider mark where provider identity is shown.
type OpenCodeLogoProps = {
  className?: string;
};

export default function OpenCodeLogo({ className = 'w-4 h-4' }: OpenCodeLogoProps) {
  /**
   * Return a distinct OpenCode icon without reusing the Codex/OpenAI mark.
   */
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-label="OpenCode">
      <rect x="3" y="4" width="18" height="16" rx="3" className="fill-orange-500" />
      <path
        d="M9 9.25 6.5 12 9 14.75M15 9.25 17.5 12 15 14.75M13 8.5 11 15.5"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
