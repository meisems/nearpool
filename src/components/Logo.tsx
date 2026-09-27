import logoMark from "../assets/logo-mark.png";

/**
 * The ponspool glass-droplet "P" mark — cropped from the brand logo (the
 * same source the favicon/app icons are generated from). Used anywhere the
 * old vector IconPondMark used to go: splash loader, navbar brand slot,
 * footer.
 */
export function Logo({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={logoMark}
      alt="ponspool"
      width={size}
      height={size}
      draggable={false}
      className={`block shrink-0 select-none object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
