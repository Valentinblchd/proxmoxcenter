type BrandLogoProps = {
  className?: string;
};

export default function BrandLogo({ className }: BrandLogoProps) {
  return (
    <svg className={className} viewBox="0 0 48 32" fill="none" aria-hidden="true">
      <path
        d="M3 4.5L14 16L3 27.5"
        stroke="currentColor"
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 4.5L26 16L15 27.5"
        stroke="currentColor"
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.86"
      />
      <path
        d="M32 4.8L24.2 27.2H29.8L37.6 4.8H32Z"
        fill="#ff9f1c"
      />
    </svg>
  );
}

