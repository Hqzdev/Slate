import Image from "next/image";
import Link from "next/link";

type BrandMarkProps = {
  href: string;
  compact?: boolean;
};

export function BrandMark({ href, compact = false }: BrandMarkProps) {
  return (
    <Link className="brand-mark" href={href} aria-label="Slate home">
      <span className={compact ? "brand-icon brand-icon-compact" : "brand-icon"}>
        <Image src="/icon.png" alt="" width={22} height={22} aria-hidden="true" priority />
      </span>
      {!compact && <span>Slate</span>}
      {compact && <span>Slate © 2026</span>}
    </Link>
  );
}
