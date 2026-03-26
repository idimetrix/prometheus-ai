"use client";

import { useCallback, useState } from "react";

type PropType = "string" | "number" | "boolean" | "enum" | "object";

interface PropDefinition {
  defaultValue?: unknown;
  description?: string;
  enumValues?: string[];
  name: string;
  type: PropType;
}

interface PropsEditorProps {
  onChange: (props: Record<string, unknown>) => void;
  propDefinitions: PropDefinition[];
  values: Record<string, unknown>;
}

export function PropsEditor({
  onChange,
  propDefinitions,
  values,
}: PropsEditorProps) {
  const [jsonEditErrors, setJsonEditErrors] = useState<
    Record<string, string | null>
  >({});

  const handleChange = useCallback(
    (name: string, value: unknown) => {
      onChange({ ...values, [name]: value });
    },
    [onChange, values]
  );

  const handleJsonChange = useCallback(
    (name: string, raw: string) => {
      try {
        const parsed = JSON.parse(raw);
        handleChange(name, parsed);
        setJsonEditErrors((prev) => ({ ...prev, [name]: null }));
      } catch {
        setJsonEditErrors((prev) => ({
          ...prev,
          [name]: "Invalid JSON",
        }));
      }
    },
    [handleChange]
  );

  function handleReset() {
    const defaults: Record<string, unknown> = {};
    for (const def of propDefinitions) {
      if (def.defaultValue !== undefined) {
        defaults[def.name] = def.defaultValue;
      }
    }
    onChange(defaults);
    setJsonEditErrors({});
  }

  if (propDefinitions.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-xs text-zinc-500">
        No editable props detected
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm text-zinc-300">Props</span>
        <button
          className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          onClick={handleReset}
          type="button"
        >
          Reset defaults
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {propDefinitions.map((def) => (
          <div className="flex flex-col gap-1" key={def.name}>
            <label
              className="flex items-center gap-2 text-xs text-zinc-400"
              htmlFor={`prop-${def.name}`}
            >
              <span>{def.name}</span>
              <span className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-600">
                {def.type}
              </span>
            </label>
            {def.description && (
              <span className="text-[10px] text-zinc-600">
                {def.description}
              </span>
            )}

            {/* String input */}
            {def.type === "string" && (
              <input
                className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-pink-500"
                id={`prop-${def.name}`}
                onChange={(e) => handleChange(def.name, e.target.value)}
                type="text"
                value={String(values[def.name] ?? "")}
              />
            )}

            {/* Number input */}
            {def.type === "number" && (
              <input
                className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-pink-500"
                id={`prop-${def.name}`}
                onChange={(e) => handleChange(def.name, Number(e.target.value))}
                type="number"
                value={Number(values[def.name] ?? 0)}
              />
            )}

            {/* Boolean toggle */}
            {def.type === "boolean" && (
              <button
                aria-checked={Boolean(values[def.name])}
                aria-label={`Toggle ${def.name}`}
                className={`relative h-6 w-10 rounded-full transition-colors ${
                  values[def.name] ? "bg-pink-500" : "bg-zinc-700"
                }`}
                id={`prop-${def.name}`}
                onClick={() => handleChange(def.name, !values[def.name])}
                role="switch"
                type="button"
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    values[def.name] ? "translate-x-4" : ""
                  }`}
                />
              </button>
            )}

            {/* Enum select */}
            {def.type === "enum" && def.enumValues && (
              <select
                className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-pink-500"
                id={`prop-${def.name}`}
                onChange={(e) => handleChange(def.name, e.target.value)}
                value={String(values[def.name] ?? "")}
              >
                {def.enumValues.map((val) => (
                  <option key={val} value={val}>
                    {val}
                  </option>
                ))}
              </select>
            )}

            {/* Object JSON editor */}
            {def.type === "object" && (
              <div className="flex flex-col gap-1">
                <textarea
                  className={`rounded-md border bg-zinc-800 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none ${
                    jsonEditErrors[def.name]
                      ? "border-red-500"
                      : "border-zinc-700 focus:border-pink-500"
                  }`}
                  id={`prop-${def.name}`}
                  onChange={(e) => handleJsonChange(def.name, e.target.value)}
                  rows={3}
                  value={
                    typeof values[def.name] === "string"
                      ? (values[def.name] as string)
                      : JSON.stringify(values[def.name] ?? {}, null, 2)
                  }
                />
                {jsonEditErrors[def.name] && (
                  <span className="text-[10px] text-red-400">
                    {jsonEditErrors[def.name]}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
