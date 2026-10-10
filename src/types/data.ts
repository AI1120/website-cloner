export type ColumnType = "text" | "number" | "boolean" | "date";

export interface DataColumn {
  name: string;
  type: ColumnType;
  required: boolean;
}

/** "owner" means only the person using the editor. */
export type DataAccess = "everyone" | "owner";

export interface DataTable {
  name: string;
  columns: DataColumn[];
  access: { create: DataAccess; read: DataAccess };
  createdAt: string;
  rowCount: number;
}

export type DataValue = string | number | boolean | null;

export interface DataRow {
  id: string;
  createdAt: string;
  values: Record<string, DataValue>;
}

export const COLUMN_TYPES: readonly ColumnType[] = ["text", "number", "boolean", "date"];

/** Table and column names: a lowercase letter, then lowercase letters, digits or underscores. */
export const DATA_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export const DATA_LIMITS = {
  tables: 20,
  columns: 30,
  rows: 10_000,
  textLength: 10_000,
  /** Largest JSON or form body the data routes accept. */
  bodyBytes: 256 * 1024,
  /** Largest CSV file that can be imported. */
  csvBytes: 2 * 1024 * 1024,
} as const;
