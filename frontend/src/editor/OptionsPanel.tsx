// Options editor (SPEC FR-39, PLAN D22): the harness-wide `options:` section, as documented in
// WireViz's syntax reference (https://github.com/wireviz/WireViz/blob/master/docs/syntax.md#options),
// for WireViz 0.4.1. Edits are text splices on the YAML (yamlEdit.ts), so the rest of the file
// stays untouched; resetting a field removes it, so WireViz's default applies again.

import { useMemo, useState } from "react";
import { WIREVIZ_COLORS } from "./wirevizColors";
import { readSection, removeSectionValue, setSectionValue, type ScalarValue } from "./yamlEdit";

type Field =
  | { key: string; kind: "color"; label: string; help: string; fallback: string }
  | {
      key: string;
      kind: "select";
      label: string;
      help: string;
      fallback: string;
      choices: [string, string][];
    }
  | { key: string; kind: "text"; label: string; help: string; fallback: string }
  | { key: string; kind: "bool"; label: string; help: string; fallback: string };

const FIELDS: Field[] = [
  {
    key: "bgcolor",
    kind: "color",
    label: "Background",
    help: "Background colour of the diagram and HTML output.",
    fallback: "WH",
  },
  {
    key: "bgcolor_node",
    kind: "color",
    label: "Node background",
    help: "Background of connectors and cables.",
    fallback: "WH",
  },
  {
    key: "bgcolor_connector",
    kind: "color",
    label: "Connector background",
    help: "Background of connectors.",
    fallback: "node background",
  },
  {
    key: "bgcolor_cable",
    kind: "color",
    label: "Cable background",
    help: "Background of cables.",
    fallback: "node background",
  },
  {
    key: "bgcolor_bundle",
    kind: "color",
    label: "Bundle background",
    help: "Background of bundles.",
    fallback: "cable background",
  },
  {
    key: "color_mode",
    kind: "select",
    label: "Colour names",
    help: "How wire colours are written in the diagram.",
    fallback: "SHORT",
    choices: [
      ["SHORT", "SHORT: uppercase short name (BK)"],
      ["short", "short: lowercase short name (bk)"],
      ["FULL", "FULL: uppercase full name (BLACK)"],
      ["full", "full: lowercase full name (black)"],
      ["HEX", "HEX: uppercase hex value (#000000)"],
      ["hex", "hex: lowercase hex value"],
      ["GER", "GER: uppercase German short name (SW)"],
      ["ger", "ger: lowercase German short name (sw)"],
    ],
  },
  {
    key: "fontname",
    kind: "text",
    label: "Font",
    help: "Font of the diagram and HTML output.",
    fallback: "arial",
  },
  {
    key: "mini_bom_mode",
    kind: "bool",
    label: "Mini BOM mode",
    help: "On: diagram boxes show only a BOM reference and basic info for additional components. Off: all their info.",
    fallback: "on",
  },
  {
    key: "template_separator",
    kind: "text",
    label: "Template separator",
    help: "Character between template and designator for generated components (as in F.).",
    fallback: ".",
  },
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const colorHex = (value: string) => WIREVIZ_COLORS.find((c) => c.code === value.toUpperCase())?.hex;

export function OptionsPanel({
  text,
  onChange,
  docsUrl = "https://github.com/wireviz/WireViz/blob/master/docs/syntax.md#options",
}: {
  text: string;
  onChange: (next: string) => void;
  docsUrl?: string;
}) {
  const values = useMemo(() => readSection(text, "options"), [text]);
  const readOnly = values === null;
  const [error, setError] = useState<string | null>(null);

  const apply = (edit: () => string) => {
    try {
      const next = edit();
      setError(null);
      if (next !== text) onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const set = (key: string, value: ScalarValue) => apply(() => setSectionValue(text, "options", key, value));
  const reset = (key: string) => apply(() => removeSectionValue(text, "options", key));

  return (
    <section className="options-panel" aria-label="Options">
      <p className="options-intro">
        Harness-wide settings (<code>options:</code>). Empty fields use WireViz's default.{" "}
        <a href={docsUrl} target="_blank" rel="noreferrer">
          WireViz docs
        </a>
      </p>
      {readOnly && <p className="options-readonly">The YAML has errors: fix them to edit the options.</p>}
      {error && <p className="options-readonly">{error}</p>}
      <div className="options-grid">
        {FIELDS.map((field) => {
          const raw = values?.[field.key];
          const isSet = raw !== undefined && raw !== null;
          return (
            <div className="option" key={field.key}>
              <label htmlFor={`opt-${field.key}`} title={field.help}>
                {field.label} <code>{field.key}</code>
              </label>
              <div className="option-input">
                <FieldInput
                  field={field}
                  value={isSet ? raw : undefined}
                  disabled={readOnly}
                  onSet={(v) => set(field.key, v)}
                />
                <button
                  className="option-reset"
                  title={`Remove ${field.key} (use the default: ${field.fallback})`}
                  aria-label={`Reset ${field.key}`}
                  disabled={readOnly || !isSet}
                  onClick={() => reset(field.key)}
                >
                  ↺
                </button>
              </div>
              <small>
                {field.help} Default: {field.fallback}.
              </small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FieldInput({
  field,
  value,
  disabled,
  onSet,
}: {
  field: Field;
  value: unknown;
  disabled: boolean;
  onSet: (value: ScalarValue) => void;
}) {
  const id = `opt-${field.key}`;
  const current = value === undefined ? "" : String(value);

  if (field.kind === "bool") {
    return (
      <select
        id={id}
        disabled={disabled}
        value={value === undefined ? "" : value ? "true" : "false"}
        onChange={(e) => e.target.value && onSet(e.target.value === "true")}
      >
        <option value="" disabled>
          default ({field.fallback})
        </option>
        <option value="true">on</option>
        <option value="false">off</option>
      </select>
    );
  }

  if (field.kind === "select") {
    const known = field.choices.some(([v]) => v === current);
    return (
      <select
        id={id}
        disabled={disabled}
        value={current}
        onChange={(e) => e.target.value && onSet(e.target.value)}
      >
        <option value="" disabled>
          default ({field.fallback})
        </option>
        {field.choices.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
        {current && !known && <option value={current}>{current} (unknown)</option>}
      </select>
    );
  }

  if (field.kind === "color")
    return <ColorInput id={id} value={current} disabled={disabled} fallback={field.fallback} onSet={onSet} />;

  return <TextInput id={id} value={current} disabled={disabled} placeholder={field.fallback} onSet={onSet} />;
}

/** Commits on Enter or when leaving the field, not on every keystroke (one edit, one undo step). */
function TextInput({
  id,
  value,
  disabled,
  placeholder,
  onSet,
}: {
  id: string;
  value: string;
  disabled: boolean;
  placeholder: string;
  onSet: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== "" && draft !== value) onSet(draft);
    setDraft(null);
  };
  return (
    <input
      id={id}
      type="text"
      disabled={disabled}
      placeholder={`default (${placeholder})`}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

function ColorInput({
  id,
  value,
  disabled,
  fallback,
  onSet,
}: {
  id: string;
  value: string;
  disabled: boolean;
  fallback: string;
  onSet: (value: string) => void;
}) {
  const code = WIREVIZ_COLORS.find((c) => c.code === value.toUpperCase())?.code;
  const isHex = HEX.test(value);
  const swatch = colorHex(value) ?? (isHex ? value : colorHex(fallback));
  const selectValue = !value ? "" : code ? code : "custom";
  return (
    <span className="color-input">
      <span className="swatch" style={{ background: swatch ?? "transparent" }} aria-hidden />
      <select
        id={id}
        disabled={disabled}
        value={selectValue}
        onChange={(e) => {
          if (e.target.value === "custom") onSet(isHex ? value : (colorHex(value) ?? "#ffffff"));
          else if (e.target.value) onSet(e.target.value);
        }}
      >
        <option value="" disabled>
          default ({fallback})
        </option>
        {WIREVIZ_COLORS.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} ({c.name})
          </option>
        ))}
        <option value="custom">custom (hex)…</option>
      </select>
      {(selectValue === "custom" || isHex) && (
        <input
          type="color"
          aria-label="Custom colour"
          disabled={disabled}
          value={isHex ? value.toLowerCase() : "#ffffff"}
          onChange={(e) => onSet(e.target.value)}
        />
      )}
      {value && !code && !isHex && <span className="options-readonly">unknown colour "{value}"</span>}
    </span>
  );
}
