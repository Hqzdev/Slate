import Link from "next/link";

type BrandMarkProps = {
  href: string;
  compact?: boolean;
};

export function BrandMark({ href, compact = false }: BrandMarkProps) {
  return (
    <Link className="brand-mark" href={href} aria-label="Slate home">
      <span className={compact ? "brand-icon brand-icon-compact" : "brand-icon"}>
        <svg aria-hidden="true" viewBox="0 0 64 64">
          <path d="M50 17H26c-8.3 0-15 6.7-15 15s6.7 15 15 15h12c8.3 0 15-6.7 15-15s-6.7-15-15-15H14" />
        </svg>
      </span>
      {!compact && <span>Slate</span>}
      {compact && <span>Slate © 2026</span>}
    </Link>
  );
}
