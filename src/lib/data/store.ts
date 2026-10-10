import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { jsonError } from "@/lib/cloner/http";
import { isValidId, pathExists, projectDir, readJson, readProject, writeJson } from "@/lib/cloner/storage";
import { parseCsv, toCsv } from "@/lib/data/csv";
import {
  COLUMN_TYPES,
  DATA_LIMITS,
  DATA_NAME_PATTERN,
  type ColumnType,
  type DataColumn,
  type DataRow,
  type DataTable,
  type DataValue,
} from "@/types/data";

/** An error whose message is safe to show to a person. */
export class DataError extends Error {
  status: number;
  /** For a rejected row: what is wrong with each field, keyed by column name. */
  fields?: Record<string, string>;

  constructor(message: string, status = 400, fields?: Record<string, string>) {
    super(message);
    this.name = "DataError";
    this.status = status;
    if (fields) this.fields = fields;
  }
}

const DEFAULT_ACCESS: DataTable["access"] = { create: "everyone", read: "owner" };
const RESERVED_COLUMNS = new Set(["id", "createdAt"]);
// Each table's rows live in a file named after the table, and Windows refuses these names.
const RESERVED_TABLES = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
// Rows are kept in one JSON file per table that is rewritten on every change,
// so a table is also capped by size; the row limit alone would allow gigabytes.
const MAX_TABLE_BYTES = 32 * 1024 * 1024;
const MAX_IMPORT_ERRORS = 20;
const ROW_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const TRUE_WORDS = new Set(["true", "on", "yes", "1"]);
const FALSE_WORDS = new Set(["false", "off", "no", "0"]);
const NAME_RULES =
  "Names start with a lowercase letter and use only lowercase letters, numbers and underscores (40 characters at most).";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quote(value: unknown): string {
  const text = typeof value === "string" ? value : String(value);
  return `"${text.length > 60 ? `${text.slice(0, 60)}…` : text}"`;
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Files and the per-project queue
// ---------------------------------------------------------------------------

type Queues = Map<string, Promise<void>>;

// Kept on `globalThis` so a hot reload in development reuses the same queues
// instead of starting a second set that could write the same files.
const globalStore = globalThis as typeof globalThis & { __siteClonerDataQueues?: Queues };
const queues: Queues = globalStore.__siteClonerDataQueues ?? new Map();
globalStore.__siteClonerDataQueues = queues;

/**
 * Runs one task at a time per project, in the order they were requested, so a
 * read-change-write of a data file never interleaves with another.
 */
async function run<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  if (typeof projectId !== "string" || !isValidId(projectId)) {
    throw new DataError("Project not found.", 404);
  }
  const previous = queues.get(projectId) ?? Promise.resolve();
  const result = previous.then(task);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(projectId, tail);
  void tail.then(() => {
    if (queues.get(projectId) === tail) queues.delete(projectId);
  });
  return result;
}

function tablesFile(projectId: string): string {
  return path.join(projectDir(projectId), "data", "tables.json");
}

function rowsFile(projectId: string, table: string): string {
  return path.join(projectDir(projectId), "data", "rows", `${table}.json`);
}

async function readList<T>(file: string, key: string): Promise<T[]> {
  const parsed = await readJson<unknown>(file);
  const list = isRecord(parsed) ? parsed[key] : undefined;
  if (Array.isArray(list)) return list as T[];
  // `readJson` answers null both for a missing file and for one it could not
  // read. Only the first means "nothing saved yet"; treating the second as
  // empty would let the next write replace real data.
  if (await pathExists(file)) {
    throw new DataError("The saved data could not be read. Try again in a moment.", 500);
  }
  return [];
}

function readTables(projectId: string): Promise<DataTable[]> {
  return readList<DataTable>(tablesFile(projectId), "tables");
}

function writeTables(projectId: string, tables: DataTable[]): Promise<void> {
  return writeJson(tablesFile(projectId), { tables });
}

function readRows(projectId: string, table: string): Promise<DataRow[]> {
  return readList<DataRow>(rowsFile(projectId, table), "rows");
}

/** Saves a table's rows, then its row count if that changed. */
async function saveRows(
  projectId: string,
  tables: DataTable[],
  table: DataTable,
  rows: DataRow[],
): Promise<void> {
  await writeJson(rowsFile(projectId, table.name), { rows });
  if (table.rowCount !== rows.length) {
    table.rowCount = rows.length;
    await writeTables(projectId, tables);
  }
}

async function requireTable(
  projectId: string,
  name: string,
): Promise<{ tables: DataTable[]; table: DataTable }> {
  const tables = await readTables(projectId);
  const table = tables.find((item) => item.name === name);
  if (!table) throw new DataError(`There is no table named ${quote(name)}.`, 404);
  return { tables, table };
}

async function assertRoomFor(projectId: string, table: DataTable, rows: DataRow[]): Promise<void> {
  if (rows.length >= DATA_LIMITS.rows) {
    throw new DataError(
      `The table ${quote(table.name)} is full (${count(DATA_LIMITS.rows)} rows). Delete some rows to add more.`,
    );
  }
  try {
    const { size } = await fs.stat(rowsFile(projectId, table.name));
    if (size >= MAX_TABLE_BYTES) {
      throw new DataError(
        `The table ${quote(table.name)} has reached its storage limit. Delete some rows to add more.`,
      );
    }
  } catch (error) {
    if (error instanceof DataError) throw error;
    // No rows file yet.
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function checkName(value: unknown, kind: "table" | "column"): string {
  if (typeof value !== "string" || value === "") {
    throw new DataError(`Every ${kind} needs a name. ${NAME_RULES}`);
  }
  if (kind === "column" && RESERVED_COLUMNS.has(value)) {
    throw new DataError(
      `${quote(value)} can't be used as a column name: every row already has an id and a createdAt.`,
    );
  }
  if (!DATA_NAME_PATTERN.test(value)) {
    throw new DataError(`${quote(value)} can't be used as a ${kind} name. ${NAME_RULES}`);
  }
  if (kind === "table" && RESERVED_TABLES.test(value)) {
    throw new DataError(`${quote(value)} can't be used as a table name. Pick a different name.`);
  }
  return value;
}

function mergeAccess(current: DataTable["access"], patch: unknown): DataTable["access"] {
  const next = { ...current };
  if (patch === undefined || patch === null) return next;
  if (!isRecord(patch)) {
    throw new DataError('Access must be an object such as { "create": "everyone", "read": "owner" }.');
  }
  for (const key of ["create", "read"] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value !== "everyone" && value !== "owner") {
      throw new DataError(`Access for "${key}" must be "everyone" or "owner".`);
    }
    next[key] = value;
  }
  return next;
}

function buildTable(spec: unknown): DataTable {
  if (!isRecord(spec)) throw new DataError("Describe the table with a name and a list of columns.");
  const name = checkName(spec.name, "table");

  if (!Array.isArray(spec.columns) || spec.columns.length === 0) {
    throw new DataError("A table needs at least one column.");
  }
  if (spec.columns.length > DATA_LIMITS.columns) {
    throw new DataError(`A table can have at most ${DATA_LIMITS.columns} columns.`);
  }

  const seen = new Set<string>();
  const columns = spec.columns.map((column: unknown): DataColumn => {
    if (!isRecord(column)) throw new DataError("Each column needs a name.");
    const columnName = checkName(column.name, "column");
    if (seen.has(columnName)) {
      throw new DataError(`The column ${quote(columnName)} is listed twice.`);
    }
    seen.add(columnName);

    const type = column.type ?? "text";
    if (!COLUMN_TYPES.includes(type as ColumnType)) {
      throw new DataError(
        `The column ${quote(columnName)} has an unknown type ${quote(type)}. Use ${COLUMN_TYPES.join(", ")}.`,
      );
    }
    return { name: columnName, type: type as ColumnType, required: column.required === true };
  });

  return {
    name,
    columns,
    access: mergeAccess(DEFAULT_ACCESS, spec.access),
    createdAt: new Date().toISOString(),
    rowCount: 0,
  };
}

/** The reason a value was rejected, phrased to follow the field's name. */
class Rejected {
  constructor(readonly reason: string) {}
}

function coerceValue(type: ColumnType, raw: unknown): DataValue | Rejected {
  if (raw === undefined || raw === null) return null;
  const text = typeof raw === "string" ? raw.trim() : null;
  if (text === "") return null;

  switch (type) {
    case "text": {
      if (typeof raw === "string") {
        return raw.length > DATA_LIMITS.textLength
          ? new Rejected(`can be at most ${count(DATA_LIMITS.textLength)} characters`)
          : raw;
      }
      if (typeof raw === "boolean" || (typeof raw === "number" && Number.isFinite(raw))) {
        return String(raw);
      }
      return new Rejected("must be text");
    }
    case "number": {
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      if (text !== null && NUMERIC.test(text) && Number.isFinite(Number(text))) return Number(text);
      return new Rejected("must be a number");
    }
    case "boolean": {
      if (typeof raw === "boolean") return raw;
      if (raw === 1 || raw === 0) return raw === 1;
      if (text !== null && TRUE_WORDS.has(text.toLowerCase())) return true;
      if (text !== null && FALSE_WORDS.has(text.toLowerCase())) return false;
      return new Rejected("must be true or false");
    }
    case "date": {
      // Text in any form `Date.parse` reads, or a number of milliseconds since 1970.
      const time = typeof raw === "number" ? raw : text !== null ? Date.parse(text) : Number.NaN;
      const date = new Date(time);
      return Number.isNaN(date.getTime()) ? new Rejected("must be a date") : date.toISOString();
    }
  }
}

/**
 * Checks a submitted row against the table's columns and returns the values to
 * store, one per column. Fields the table doesn't have are dropped.
 */
function coerceRow(columns: DataColumn[], input: unknown): Record<string, DataValue> {
  if (!isRecord(input)) {
    throw new DataError("Send the row as an object of field names and values.");
  }

  const values: Record<string, DataValue> = {};
  const problems: Record<string, string> = {};
  let filled = 0;
  for (const column of columns) {
    // Own properties only: a column may be called "constructor".
    const raw = Object.hasOwn(input, column.name) ? input[column.name] : undefined;
    const value = coerceValue(column.type, raw);
    if (value instanceof Rejected) {
      problems[column.name] = `"${column.name}" ${value.reason}.`;
    } else if (value === null && column.required) {
      problems[column.name] = `"${column.name}" is required.`;
    } else {
      values[column.name] = value;
      if (value !== null) filled += 1;
    }
  }

  const messages = Object.values(problems);
  if (messages.length > 0) throw new DataError(messages.join(" "), 400, problems);
  if (filled === 0) {
    throw new DataError(
      `Nothing to save: send at least one of this table's fields (${columns.map((column) => column.name).join(", ")}).`,
    );
  }
  return values;
}

function valueOf(row: DataRow, column: string): DataValue {
  return isRecord(row.values) && Object.hasOwn(row.values, column) ? row.values[column] : null;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export async function listTables(projectId: string): Promise<DataTable[]> {
  return run(projectId, () => readTables(projectId));
}

export async function getTable(projectId: string, table: string): Promise<DataTable | null> {
  return run(projectId, async () => {
    const tables = await readTables(projectId);
    return tables.find((item) => item.name === table) ?? null;
  });
}

export async function createTable(
  projectId: string,
  spec: {
    name: string;
    columns: { name: string; type?: ColumnType; required?: boolean }[];
    access?: Partial<DataTable["access"]>;
  },
): Promise<DataTable> {
  const table = buildTable(spec);
  return run(projectId, async () => {
    if (!(await readProject(projectId))) throw new DataError("Project not found.", 404);
    const tables = await readTables(projectId);
    if (tables.some((item) => item.name === table.name)) {
      throw new DataError(`A table named ${quote(table.name)} already exists.`);
    }
    if (tables.length >= DATA_LIMITS.tables) {
      throw new DataError(
        `A project can have at most ${DATA_LIMITS.tables} tables. Delete one to add another.`,
      );
    }
    // Rows left behind by an earlier table of this name must not show up in the new one.
    await fs.rm(rowsFile(projectId, table.name), { force: true });
    await writeTables(projectId, [...tables, table]);
    return table;
  });
}

export async function deleteTable(projectId: string, table: string): Promise<void> {
  return run(projectId, async () => {
    const { tables, table: target } = await requireTable(projectId, table);
    await writeTables(
      projectId,
      tables.filter((item) => item !== target),
    );
    await fs.rm(rowsFile(projectId, target.name), { force: true });
  });
}

export async function updateAccess(
  projectId: string,
  table: string,
  access: Partial<DataTable["access"]>,
): Promise<DataTable> {
  return run(projectId, async () => {
    const { tables, table: target } = await requireTable(projectId, table);
    target.access = mergeAccess(target.access, access);
    await writeTables(projectId, tables);
    return target;
  });
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** A page of the table's rows, newest first. */
export async function listRows(
  projectId: string,
  table: string,
  options: { limit?: number; offset?: number } = {},
): Promise<{ rows: DataRow[]; total: number }> {
  const limit = Number.isFinite(options.limit)
    ? Math.min(Math.max(Math.trunc(options.limit as number), 0), DATA_LIMITS.rows)
    : 100;
  const offset = Number.isFinite(options.offset) ? Math.max(Math.trunc(options.offset as number), 0) : 0;

  return run(projectId, async () => {
    const { table: target } = await requireTable(projectId, table);
    const rows = await readRows(projectId, target.name);
    // Imported rows keep their original dates, so file order isn't always date order.
    const newestFirst = rows
      .map((row, index) => ({ row, index, time: Date.parse(row.createdAt) || 0 }))
      .sort((a, b) => b.time - a.time || b.index - a.index)
      .map((entry) => entry.row);
    return { rows: newestFirst.slice(offset, offset + limit), total: rows.length };
  });
}

/**
 * Adds a row. Values are checked against the table's columns and converted to
 * each column's type; fields the table doesn't have are dropped.
 */
export async function insertRow(projectId: string, table: string, input: unknown): Promise<DataRow> {
  return run(projectId, async () => {
    const { tables, table: target } = await requireTable(projectId, table);
    const values = coerceRow(target.columns, input);
    const rows = await readRows(projectId, target.name);
    await assertRoomFor(projectId, target, rows);

    const row: DataRow = { id: randomUUID(), createdAt: new Date().toISOString(), values };
    rows.push(row);
    await saveRows(projectId, tables, target, rows);
    return row;
  });
}

/** Deletes the rows with the given ids, or every row, and returns how many were removed. */
export async function deleteRows(projectId: string, table: string, ids: string[] | "all"): Promise<number> {
  if (ids !== "all" && !(Array.isArray(ids) && ids.every((id) => typeof id === "string"))) {
    throw new DataError('Say which rows to delete: a list of row ids, or "all".');
  }
  return run(projectId, async () => {
    const { tables, table: target } = await requireTable(projectId, table);
    const rows = await readRows(projectId, target.name);
    const doomed = ids === "all" ? null : new Set(ids);
    const kept = doomed ? rows.filter((row) => !doomed.has(row.id)) : [];
    if (kept.length !== rows.length || target.rowCount !== kept.length) {
      await saveRows(projectId, tables, target, kept);
    }
    return rows.length - kept.length;
  });
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

type Heading = { kind: "column"; name: string } | { kind: "id" | "createdAt" | "ignored" };

function matchHeading(heading: string, columns: DataColumn[]): Heading {
  const exact = heading.trim();
  if (columns.some((column) => column.name === exact)) return { kind: "column", name: exact };
  if (exact === "id" || exact === "createdAt") return { kind: exact };
  // Otherwise compare letters and digits only, so "First Name" finds
  // first_name and "E-mail" finds email.
  const letters = exact.toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = letters && columns.find((column) => column.name.replace(/_/g, "") === letters);
  return match ? { kind: "column", name: match.name } : { kind: "ignored" };
}

/**
 * Adds the rows of a CSV file whose first line names the columns. Rows that
 * don't fit the table are skipped and explained in `errors`. An `id` or
 * `createdAt` column, as written by `exportCsv`, is kept when it is usable.
 */
export async function importCsv(
  projectId: string,
  table: string,
  csv: string,
): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  if (typeof csv !== "string") throw new DataError("Send the text of a CSV file.");
  if (Buffer.byteLength(csv, "utf8") > DATA_LIMITS.csvBytes) {
    throw new DataError("A CSV file can be at most 2 MB.", 413);
  }
  const [header, ...lines] = parseCsv(csv);
  if (!header) throw new DataError("The CSV file is empty.");

  return run(projectId, async () => {
    const { tables, table: target } = await requireTable(projectId, table);
    const headings = header.map((heading) => matchHeading(heading, target.columns));
    if (!headings.some((heading) => heading.kind === "column")) {
      throw new DataError(
        `The first line of the CSV must name the columns, and none of its headings match this table's columns (${target.columns.map((column) => column.name).join(", ")}).`,
      );
    }

    const rows = await readRows(projectId, target.name);
    if (lines.length > 0) await assertRoomFor(projectId, target, rows);

    const usedIds = new Set(rows.map((row) => row.id));
    const now = new Date().toISOString();
    const errors: string[] = [];
    let inserted = 0;
    let invalid = 0;
    let overflow = 0;

    lines.forEach((line, index) => {
      if (rows.length >= DATA_LIMITS.rows) {
        overflow += 1;
        return;
      }
      const input: Record<string, string> = {};
      let id = "";
      let createdAt = now;
      headings.forEach((heading, position) => {
        const cell = line[position] ?? "";
        if (heading.kind === "column") {
          input[heading.name] = cell;
        } else if (heading.kind === "id") {
          id = cell.trim();
        } else if (heading.kind === "createdAt") {
          const date = new Date(Date.parse(cell.trim()));
          if (!Number.isNaN(date.getTime())) createdAt = date.toISOString();
        }
      });

      let values: Record<string, DataValue>;
      try {
        values = coerceRow(target.columns, input);
      } catch (error) {
        if (!(error instanceof DataError)) throw error;
        invalid += 1;
        // Numbered as a spreadsheet shows it: the headings are row 1.
        if (errors.length < MAX_IMPORT_ERRORS) errors.push(`Row ${index + 2}: ${error.message}`);
        return;
      }

      if (!ROW_ID_PATTERN.test(id) || usedIds.has(id)) id = randomUUID();
      usedIds.add(id);
      rows.push({ id, createdAt, values });
      inserted += 1;
    });

    if (invalid > errors.length) {
      errors.push(`${count(invalid - errors.length)} more rows had problems.`);
    }
    if (overflow > 0) {
      errors.push(
        `The table is full (${count(DATA_LIMITS.rows)} rows), so the last ${count(overflow)} rows of the file were not imported.`,
      );
    }
    if (inserted > 0) await saveRows(projectId, tables, target, rows);
    return { inserted, skipped: invalid + overflow, errors };
  });
}

function csvCell(value: DataValue): string {
  return value === null ? "" : String(value);
}

/** The whole table as CSV, oldest row first. Columns: id, createdAt, then the table's own. */
export async function exportCsv(projectId: string, table: string): Promise<string> {
  return run(projectId, async () => {
    const { table: target } = await requireTable(projectId, table);
    const rows = await readRows(projectId, target.name);
    const names = target.columns.map((column) => column.name);
    return toCsv([
      ["id", "createdAt", ...names],
      ...rows.map((row) => [row.id, row.createdAt, ...names.map((name) => csvCell(valueOf(row, name)))]),
    ]);
  });
}

// ---------------------------------------------------------------------------
// Helpers shared by the data route handlers
// ---------------------------------------------------------------------------

/** Reads a request body, or returns null as soon as it is larger than `maxBytes`. */
export async function readBody(request: Request, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return Buffer.alloc(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Reads a JSON request body of at most 256 KB. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const body = await readBody(request, DATA_LIMITS.bodyBytes);
  if (body === null) throw new DataError("The request is too large. The limit is 256 KB.", 413);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new DataError("The request could not be read as JSON.");
  }
}

/** Turns an error thrown by the store, or anything unexpected, into a JSON response. */
export function dataErrorResponse(error: unknown): Response {
  if (error instanceof DataError) {
    return error.fields
      ? Response.json({ error: error.message, fields: error.fields }, { status: error.status })
      : jsonError(error.message, error.status);
  }
  console.error("Data request failed:", error);
  return jsonError("Something went wrong while handling the data. Try again.", 500);
}
