"use client";

import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PropType = "string" | "number" | "boolean" | "enum" | "color" | "object";

interface PropDefinition {
  defaultValue?: unknown;
  description?: string;
  enumValues?: string[];
  max?: number;
  min?: number;
  name: string;
  step?: number;
  type: PropType;
}

interface PropsEditorProps {
  componentName?: string;
  onChange: (props: Record<string, unknown>) => void;
  propDefinitions: PropDefinition[];
  values: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

const SKIP_PROPS = new Set(["children", "className", "ref", "key"]);
const COLOR_NAME_RE = /color/i;
const LEADING_QUOTE_RE = /^"/;
const TRAILING_QUOTE_RE = /"$/;
const INTERFACE_PROPS_RE = /interface\s+\w*Props\w*\s*\{([\s\S]*?)\}/;
const PROP_LINE_RE =
  /(\w+)\??:\s*(string|number|boolean|"[^"]*"(?:\s*\|\s*"[^"]*")*)/;

/** Convert a raw type string into a PropDefinition. */
function parsePropType(name: string, typeStr: string): PropDefinition | null {
  if (typeStr === "string") {
    const isColor = COLOR_NAME_RE.test(name);
    return isColor
      ? { name, type: "color", defaultValue: "#000000" }
      : { name, type: "string", defaultValue: "" };
  }
  if (typeStr === "number") {
    return { name, type: "number", defaultValue: 0, min: 0, max: 100 };
  }
  if (typeStr === "boolean") {
    return { name, type: "boolean", defaultValue: false };
  }
  if (typeStr.includes("|")) {
    const enumValues = typeStr
      .split("|")
      .map((v) =>
        v.trim().replace(LEADING_QUOTE_RE, "").replace(TRAILING_QUOTE_RE, "")
      )
      .filter(Boolean);
    return { name, type: "enum", enumValues, defaultValue: enumValues[0] };
  }
  return null;
}

/** Try to parse a single interface line into a PropDefinition. */
function parsePropLine(line: string): PropDefinition | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
    return null;
  }

  const propMatch = trimmed.match(PROP_LINE_RE);
  if (!propMatch) {
    return null;
  }

  const name = propMatch[1];
  const typeStr = propMatch[2];
  if (!(name && typeStr) || SKIP_PROPS.has(name)) {
    return null;
  }

  return parsePropType(name, typeStr);
}

/**
 * Auto-detect prop definitions from generated component code.
 * Parses TypeScript interface/type definitions for common patterns.
 */
export function detectPropsFromCode(code: string): PropDefinition[] {
  const interfaceMatch = code.match(INTERFACE_PROPS_RE);
  if (!interfaceMatch?.[1]) {
    return [];
  }

  const lines = interfaceMatch[1].split("\n");
  const props: PropDefinition[] = [];

  for (const line of lines) {
    const parsed = parsePropLine(line);
    if (parsed) {
      props.push(parsed);
    }
  }

  return props;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PropsEditor({
  componentName = "Component",
  onChange,
  propDefinitions,
  values,
}: PropsEditorProps) {
  const [jsonEditErrors, setJsonEditErrors] = useState<
    Record<string, string | null>
  >({});
  const [showExport, setShowExport] = useState(false);

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

  /** Export current prop values as JSON */
  const exportJson = useMemo(() => {
    const cleanValues: Record<string, unknown> = {};
    for (const def of propDefinitions) {
      const val = values[def.name];
      if (val !== undefined && val !== def.defaultValue) {
        cleanValues[def.name] = val;
      }
    }
    return JSON.stringify(cleanValues, null, 2);
  }, [propDefinitions, values]);

  /** Generate component usage string with current props */
  const componentUsage = useMemo(() => {
    const propEntries: string[] = [];
    for (const def of propDefinitions) {
      const val = values[def.name];
      if (val === undefined || val === def.defaultValue) {
        continue;
      }
      if (typeof val === "string") {
        propEntries.push(`${def.name}="${val}"`);
      } else if (typeof val === "boolean") {
        propEntries.push(val ? def.name : `${def.name}={false}`);
      } else {
        propEntries.push(`${def.name}={${JSON.stringify(val)}}`);
      }
    }

    if (propEntries.length === 0) {
      return `<${componentName} />`;
    }
    if (propEntries.length <= 2) {
      return `<${componentName} ${propEntries.join(" ")} />`;
    }
    return `<${componentName}\n  ${propEntries.join("\n  ")}\n/>`;
  }, [componentName, propDefinitions, values]);

  function handleCopyUsage() {
    navigator.clipboard.writeText(componentUsage);
    toast.success("Component usage copied to clipboard");
  }

  function handleCopyJson() {
    navigator.clipboard.writeText(exportJson);
    toast.success("Props JSON copied to clipboard");
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
        <div className="flex items-center gap-2">
          <button
            className={`text-xs transition-colors ${
              showExport ? "text-pink-400" : "text-zinc-500 hover:text-zinc-300"
            }`}
            onClick={() => setShowExport((prev) => !prev)}
            type="button"
          >
            Export
          </button>
          <button
            className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
            onClick={handleReset}
            type="button"
          >
            Reset defaults
          </button>
        </div>
      </div>

      {/* Export panel */}
      {showExport && (
        <div className="flex flex-col gap-2 rounded-md border border-zinc-700 bg-zinc-800/50 p-3">
          {/* Component usage */}
          <div className="flex items-center justify-between">
            <span className="font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
              Usage
            </span>
            <button
              className="text-[10px] text-zinc-500 transition-colors hover:text-zinc-300"
              onClick={handleCopyUsage}
              type="button"
            >
              Copy
            </button>
          </div>
          <pre className="overflow-auto rounded bg-zinc-900 p-2 font-mono text-[11px] text-zinc-300">
            {componentUsage}
          </pre>

          {/* JSON export */}
          <div className="flex items-center justify-between">
            <span className="font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
              Props JSON
            </span>
            <button
              className="text-[10px] text-zinc-500 transition-colors hover:text-zinc-300"
              onClick={handleCopyJson}
              type="button"
            >
              Copy
            </button>
          </div>
          <pre className="overflow-auto rounded bg-zinc-900 p-2 font-mono text-[11px] text-zinc-300">
            {exportJson}
          </pre>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {propDefinitions.map((def) => (
          <PropField
            def={def}
            jsonError={jsonEditErrors[def.name] ?? null}
            key={def.name}
            onChange={handleChange}
            onJsonChange={handleJsonChange}
            value={values[def.name]}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PropField sub-component
// ---------------------------------------------------------------------------

interface PropFieldProps {
  def: PropDefinition;
  jsonError: string | null;
  onChange: (name: string, value: unknown) => void;
  onJsonChange: (name: string, raw: string) => void;
  value: unknown;
}

function PropField({
  def,
  jsonError,
  onChange,
  onJsonChange,
  value,
}: PropFieldProps) {
  const id = `prop-${def.name}`;

  return (
    <div className="flex flex-col gap-1">
      <label
        className="flex items-center gap-2 text-xs text-zinc-400"
        htmlFor={id}
      >
        <span>{def.name}</span>
        <span className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-600">
          {def.type}
        </span>
      </label>
      {def.description && (
        <span className="text-[10px] text-zinc-600">{def.description}</span>
      )}

      <PropInput
        def={def}
        id={id}
        jsonError={jsonError}
        onChange={onChange}
        onJsonChange={onJsonChange}
        value={value}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual prop type inputs
// ---------------------------------------------------------------------------

interface SinglePropInputProps {
  def: PropDefinition;
  id: string;
  jsonError: string | null;
  onChange: (name: string, value: unknown) => void;
  onJsonChange: (name: string, raw: string) => void;
  value: unknown;
}

function StringInput({ def, id, onChange, value }: SinglePropInputProps) {
  return (
    <input
      className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-pink-500"
      id={id}
      onChange={(e) => onChange(def.name, e.target.value)}
      type="text"
      value={String(value ?? "")}
    />
  );
}

function NumberInput({ def, id, onChange, value }: SinglePropInputProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-pink-500"
        id={id}
        max={def.max ?? 100}
        min={def.min ?? 0}
        onChange={(e) => onChange(def.name, Number(e.target.value))}
        step={def.step ?? 1}
        type="range"
        value={Number(value ?? 0)}
      />
      <input
        aria-label={`${def.name} value`}
        className="w-16 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-center text-xs text-zinc-200 outline-none focus:border-pink-500"
        max={def.max ?? 100}
        min={def.min ?? 0}
        onChange={(e) => onChange(def.name, Number(e.target.value))}
        step={def.step ?? 1}
        type="number"
        value={Number(value ?? 0)}
      />
    </div>
  );
}

function BooleanInput({ def, id, onChange, value }: SinglePropInputProps) {
  return (
    <button
      aria-checked={Boolean(value)}
      aria-label={`Toggle ${def.name}`}
      className={`relative h-6 w-10 rounded-full transition-colors ${
        value ? "bg-pink-500" : "bg-zinc-700"
      }`}
      id={id}
      onClick={() => onChange(def.name, !value)}
      role="switch"
      type="button"
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          value ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

function EnumInput({ def, id, onChange, value }: SinglePropInputProps) {
  if (!def.enumValues) {
    return null;
  }
  return (
    <select
      className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-pink-500"
      id={id}
      onChange={(e) => onChange(def.name, e.target.value)}
      value={String(value ?? "")}
    >
      {def.enumValues.map((val) => (
        <option key={val} value={val}>
          {val}
        </option>
      ))}
    </select>
  );
}

function ColorInput({ def, id, onChange, value }: SinglePropInputProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        className="h-8 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent p-0"
        id={id}
        onChange={(e) => onChange(def.name, e.target.value)}
        type="color"
        value={COLOR_RE.test(String(value ?? "")) ? String(value) : "#000000"}
      />
      <input
        aria-label={`${def.name} hex value`}
        className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none focus:border-pink-500"
        onChange={(e) => onChange(def.name, e.target.value)}
        type="text"
        value={String(value ?? "#000000")}
      />
    </div>
  );
}

function ObjectInput({
  def,
  id,
  jsonError,
  onJsonChange,
  value,
}: SinglePropInputProps) {
  return (
    <div className="flex flex-col gap-1">
      <textarea
        className={`rounded-md border bg-zinc-800 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none ${
          jsonError ? "border-red-500" : "border-zinc-700 focus:border-pink-500"
        }`}
        id={id}
        onChange={(e) => onJsonChange(def.name, e.target.value)}
        rows={3}
        value={
          typeof value === "string"
            ? (value as string)
            : JSON.stringify(value ?? {}, null, 2)
        }
      />
      {jsonError && (
        <span className="text-[10px] text-red-400">{jsonError}</span>
      )}
    </div>
  );
}

const PROP_INPUT_MAP: Record<
  PropType,
  (props: SinglePropInputProps) => React.JSX.Element | null
> = {
  string: StringInput,
  number: NumberInput,
  boolean: BooleanInput,
  enum: EnumInput,
  color: ColorInput,
  object: ObjectInput,
};

function PropInput(props: SinglePropInputProps) {
  const Renderer = PROP_INPUT_MAP[props.def.type];
  return Renderer ? <Renderer {...props} /> : null;
}
