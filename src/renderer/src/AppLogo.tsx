/**
 * Brand mark for in-app UI (blue palette). Keep in sync with build/icon + tray assets.
 */
export function AppLogo({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect width="32" height="32" rx="8" fill="#011f4b" />
      <rect
        x="2.5"
        y="2.5"
        width="27"
        height="27"
        rx="6.5"
        stroke="#005b96"
        strokeWidth="1.5"
        fill="#03396c"
      />
      <circle
        cx="16"
        cy="17"
        r="6.5"
        stroke="#b3cde0"
        strokeWidth="1.25"
        fill="none"
      />
      <path
        d="M16 11.5V16.2L19 18"
        stroke="#6497b1"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="17" r="1.2" fill="#b3cde0" />
    </svg>
  );
}
