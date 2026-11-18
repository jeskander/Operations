"use client";

export type Version = "simple" | "notion" | "classic";

const OPTIONS: { value: Version; label: string }[] = [
  { value: "simple", label: "Simple" },
  { value: "notion", label: "Notion-style" },
  { value: "classic", label: "Classic" },
];

/** Which version of the page to use, one tap away on every operation. Kept per device. */
export default function VersionSwitch({ value, onChange }: { value: Version; onChange: (v: Version) => void }) {
  return (
    <div className="version-switch" role="radiogroup" aria-label="Version">
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className="version-opt" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
