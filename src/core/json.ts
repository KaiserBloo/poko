import type { JsonValue } from "../adapters/types.ts";

export const stringifyJson = (value: JsonValue): string =>
  `${formatJsonValue(value, 0)}\n`;

const formatJsonValue = (value: JsonValue, indent: number): string => {
  if (Array.isArray(value)) {
    return formatJsonArray(value, indent);
  }

  if (typeof value === "object" && value !== null) {
    return formatJsonObject(value, indent);
  }

  return JSON.stringify(value);
};

const formatJsonArray = (value: JsonValue[], indent: number): string => {
  if (value.length === 0) {
    return "[]";
  }

  if (value.every(isPrimitiveJsonValue)) {
    return `[${value.map((entry) => JSON.stringify(entry)).join(", ")}]`;
  }

  const nextIndent = indent + 2;
  const pad = " ".repeat(indent);
  const itemPad = " ".repeat(nextIndent);

  return `[\n${value
    .map((entry) => `${itemPad}${formatJsonValue(entry, nextIndent)}`)
    .join(",\n")}\n${pad}]`;
};

const formatJsonObject = (
  value: Record<string, JsonValue>,
  indent: number,
): string => {
  const entries = Object.entries(value);

  if (entries.length === 0) {
    return "{}";
  }

  const nextIndent = indent + 2;
  const pad = " ".repeat(indent);
  const itemPad = " ".repeat(nextIndent);

  return `{\n${entries
    .map(
      ([key, entry]) =>
        `${itemPad}${JSON.stringify(key)}: ${formatJsonValue(entry, nextIndent)}`,
    )
    .join(",\n")}\n${pad}}`;
};

const isPrimitiveJsonValue = (value: JsonValue): boolean =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";
