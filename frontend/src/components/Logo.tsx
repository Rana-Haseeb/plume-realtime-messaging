/**
 * Plume logo — a feather (light, effortless messaging) that also reads as a
 * plume/signal trailing upward. White mark on an indigo gradient tile.
 */
export default function Logo({ size = 80 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-label="Plume"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="plumeTile" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6a6ff0" />
          <stop offset="0.55" stopColor="#4e57d4" />
          <stop offset="1" stopColor="#3a3fb0" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill="url(#plumeTile)" />

      {/* Bare quill stem */}
      <path d="M14 35.5 L10.4 39.6" stroke="white" strokeWidth="2.4" strokeLinecap="round" />

      {/* Feather vane */}
      <path
        d="M14 35.5 C16 26 21 18.5 35 10.5 C33.4 19 28.6 27 14 35.5 Z"
        fill="white"
      />

      {/* Central spine */}
      <path
        d="M14 35.5 C20 29.2 27 21.2 33.4 12.6"
        stroke="#4e57d4"
        strokeWidth="1.7"
        strokeLinecap="round"
      />

      {/* Barbs */}
      <path
        d="M18.7 31 L16.3 32.7 M21.9 26.7 L19.4 28.3 M25.1 22.4 L22.6 24 M28.3 18.1 L25.9 19.7"
        stroke="#4e57d4"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}
