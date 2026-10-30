/**
 * A JSON value as a tree: objects and arrays fold open with their size shown,
 * scalars keep their type's look. The first two levels start open.
 */

import { useTranslation } from "@/i18n";

function Scalar({ value }: { value: unknown }) {
  if (typeof value === "string") {
    return <span className="text-[var(--system-positive-strong)]">{JSON.stringify(value)}</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="text-[var(--system-info-strong)]">{String(value)}</span>;
  }
  return <span className="text-[var(--content-tertiary)]">{JSON.stringify(null)}</span>;
}

export function AnuJsonTree({
  value,
  name,
  depth = 0,
}: {
  value: unknown;
  name?: string;
  depth?: number;
}) {
  const { t } = useTranslation("anu");
  const label =
    name === undefined ? null : (
      <span className="text-[var(--content-secondary)]">{name}: </span>
    );
  if (value === null || typeof value !== "object") {
    return (
      <div className="ps-4">
        {label}
        <Scalar value={value} />
      </div>
    );
  }
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value);
  return (
    <details open={depth < 2} className="ps-4">
      <summary className="cursor-pointer list-none text-[var(--content-default)] marker:hidden">
        {label}
        <span className="text-[var(--content-tertiary)]">
          {Array.isArray(value)
            ? t("anuFiles.jsonItems", { count: entries.length })
            : t("anuFiles.jsonKeys", { count: entries.length })}
        </span>
      </summary>
      {entries.map(([key, item]) => (
        <AnuJsonTree key={key} name={key} value={item} depth={depth + 1} />
      ))}
    </details>
  );
}
