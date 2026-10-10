"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  Copy,
  Database,
  Download,
  Ellipsis,
  LoaderCircle,
  Plus,
  RefreshCw,
  Table2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { Segmented, type SegmentedOption } from "@/components/cloner/segmented";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  COLUMN_TYPES,
  DATA_LIMITS,
  type ColumnType,
  type DataAccess,
  type DataColumn,
  type DataRow,
  type DataTable,
  type DataValue,
} from "@/types/data";
import type { Project } from "@/types/project";

/** Rows shown at a time; sorting and selection still cover the whole table. */
const PAGE_SIZE = 100;
/** Pane width (Tailwind's `@2xl`) from which the table list sits beside the open table. */
const SIDE_BY_SIDE_WIDTH = 672;

const ACCESS_OPTIONS: SegmentedOption<DataAccess>[] = [
  { value: "everyone", label: "Everyone" },
  { value: "owner", label: "Only me" },
];

const TYPE_LABELS: Record<ColumnType, string> = {
  text: "Text",
  number: "Number",
  boolean: "Yes / no",
  date: "Date and time",
};

const FIELD_CLASS =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const HEAD_CELL =
  "sticky top-0 z-10 h-9 border-b bg-background px-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground";
const BODY_CELL = "h-9 border-b px-3 py-1.5 whitespace-nowrap";

// ---------------------------------------------------------------------------
// Talking to the API
// ---------------------------------------------------------------------------

type ApiResult<T> =
  | { ok: true; body: T }
  | { ok: false; message: string; fields: Record<string, string> };

/** Calls a data route and returns its JSON, or the message (and per-field messages) of its error. */
async function api<T>(url: string, fallback: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, init);
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && body !== null) return { ok: true, body: body as T };

    const failure = body as { error?: unknown; fields?: unknown } | null;
    const fields: Record<string, string> = {};
    if (typeof failure?.fields === "object" && failure.fields !== null) {
      for (const [name, message] of Object.entries(failure.fields)) {
        if (typeof message === "string") fields[name] = message;
      }
    }
    return {
      ok: false,
      message: typeof failure?.error === "string" && failure.error ? failure.error : fallback,
      fields,
    };
  } catch {
    return { ok: false, message: "Couldn't reach the app. Is it still running?", fields: {} };
  }
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

interface GridColumn {
  key: string;
  type: ColumnType | "id";
}

interface Sort {
  key: string;
  direction: "asc" | "desc";
}

/** The table's own columns, then the two every row has. */
function gridColumns(table: DataTable): GridColumn[] {
  return [
    ...table.columns.map((column) => ({ key: column.name, type: column.type })),
    { key: "createdAt", type: "date" },
    { key: "id", type: "id" },
  ];
}

function cellValue(row: DataRow, key: string): DataValue {
  if (key === "id") return row.id;
  if (key === "createdAt") return row.createdAt;
  return Object.hasOwn(row.values, key) ? row.values[key] : null;
}

/** What to call a row in control labels: its first filled-in value, preferably text, else its id. */
function rowLabel(row: DataRow, table: DataTable): string {
  const filled = table.columns.filter((column) => cellValue(row, column.name) !== null);
  const column = filled.find((item) => item.type === "text") ?? filled[0];
  return column ? String(cellValue(row, column.name)).slice(0, 40) : row.id.slice(0, 8);
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sortRows(rows: DataRow[], sort: Sort | null, type: GridColumn["type"] | undefined): DataRow[] {
  if (!sort) return rows;
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((first, second) => {
    const a = cellValue(first, sort.key);
    const b = cellValue(second, sort.key);
    // Empty values stay at the end whichever way the column is sorted.
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    if (typeof a === "number" && typeof b === "number") return (a - b) * factor;
    if (typeof a === "boolean" && typeof b === "boolean") return (Number(a) - Number(b)) * factor;
    // Dates are stored as ISO text, which orders correctly as plain text.
    if (type === "date") return (a < b ? -1 : a > b ? 1 : 0) * factor;
    return collator.compare(String(a), String(b)) * factor;
  });
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function GridCell({ value, type }: { value: DataValue; type: GridColumn["type"] }) {
  if (value === null) {
    return (
      <span className="text-muted-foreground/50">
        <span aria-hidden="true">—</span>
        <span className="sr-only">empty</span>
      </span>
    );
  }
  const text = String(value);
  if (type === "id") {
    return (
      <span className="font-mono text-xs text-muted-foreground" title={text}>
        {text.length > 8 ? `${text.slice(0, 8)}…` : text}
      </span>
    );
  }
  if (type === "date") {
    return (
      <time dateTime={text} title={text}>
        {formatDate(text)}
      </time>
    );
  }
  if (type === "boolean") return value === true ? "Yes" : "No";
  if (type === "number") return <span className="tabular-nums">{text}</span>;
  return (
    <span className="block max-w-80 truncate" title={text.length > 30 ? text : undefined}>
      {text}
    </span>
  );
}

function accessLabel(access: DataAccess): string {
  return access === "everyone" ? "everyone" : "only me";
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
      <LoaderCircle className="size-5 animate-spin" aria-label={label} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The pane
// ---------------------------------------------------------------------------

type Panel = "new-table" | "add-row" | null;

interface DataPaneProps {
  project: Project;
  /** Changes whenever the project changes outside this pane; the AI may have created tables. */
  version: number;
}

export function DataPane({ project, version }: DataPaneProps) {
  const projectId = project.id;
  const rootRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{ projectId: string; tables: DataTable[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [reloads, setReloads] = useState(0);
  const [hiddenColumns, setHiddenColumns] = useState<Record<string, string[]>>({});

  const tables = loaded?.projectId === projectId ? loaded.tables : null;
  const current = tables?.find((table) => table.name === selected) ?? null;
  const openPanel: Panel = panel === "add-row" && !current ? null : panel;
  const atTableLimit = (tables?.length ?? 0) >= DATA_LIMITS.tables;

  const reload = useCallback(() => setReloads((count) => count + 1), []);

  useEffect(() => {
    let cancelled = false;
    void api<{ tables: DataTable[] }>(
      `/api/projects/${projectId}/data`,
      "The tables could not be loaded.",
    ).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      const next = result.body.tables;
      // Beside the list there is room to open a table straight away; on a
      // narrow pane the list is the first screen.
      const sideBySide = (rootRef.current?.clientWidth ?? 0) >= SIDE_BY_SIDE_WIDTH;
      setLoadError(null);
      setLoaded({ projectId, tables: next });
      setSelected((name) =>
        next.some((table) => table.name === name) ? name : sideBySide ? (next[0]?.name ?? null) : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, version, reloads]);

  const replaceTable = useCallback(
    (table: DataTable) => {
      setLoaded((value) =>
        value && value.projectId === projectId
          ? { ...value, tables: value.tables.map((item) => (item.name === table.name ? table : item)) }
          : value,
      );
    },
    [projectId],
  );

  const closePanel = useCallback(() => setPanel(null), []);

  // The control that opened the side panel gets the focus back when it closes.
  // It is noted here, before the panel renders: on a narrow pane the panel
  // hides that control, and a hidden control loses focus at once.
  const openerRef = useRef<HTMLElement | null>(null);
  const showPanel = useCallback((next: "new-table" | "add-row") => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanel(next);
  }, []);

  // Below `@4xl` an open side panel takes the pane over, so what it covers is
  // hidden rather than left behind it where the keyboard could still reach.
  const covered = openPanel !== null;

  useEffect(() => {
    if (covered) return;
    const opener = openerRef.current;
    openerRef.current = null;
    // Only when closing left the focus nowhere; a click elsewhere keeps it.
    if (opener?.isConnected && document.activeElement === document.body) opener.focus();
  }, [covered]);

  return (
    <div ref={rootRef} className="@container/pane flex min-h-0 flex-1">
      {tables === null ? (
        loadError ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p role="alert" className="text-sm text-destructive">
              {loadError}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoadError(null);
                reload();
              }}
            >
              <RefreshCw data-icon="inline-start" />
              Try again
            </Button>
          </div>
        ) : (
          <Spinner label="Loading tables" />
        )
      ) : tables.length === 0 ? (
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-6 text-center",
            covered ? "hidden @4xl/pane:flex" : "flex",
          )}
        >
          <Database className="size-8 text-muted-foreground/60" aria-hidden="true" />
          <h2 className="text-sm font-medium">No tables yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Tables store what your app collects, such as contact form submissions. Ask the AI for
            one, for example &ldquo;Add a contact form that saves submissions&rdquo;, or create one
            yourself with New table.
          </p>
          <Button size="sm" onClick={() => showPanel("new-table")}>
            <Plus data-icon="inline-start" />
            New table
          </Button>
        </div>
      ) : (
        <>
          <nav
            aria-label="Tables"
            className={cn(
              "min-h-0 min-w-0 flex-col @2xl/pane:w-60 @2xl/pane:flex-none @2xl/pane:border-r",
              covered ? "hidden @4xl/pane:flex" : current ? "hidden @2xl/pane:flex" : "flex flex-1",
            )}
          >
            <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
              <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
                Tables{" "}
                <span className="font-normal text-muted-foreground tabular-nums">{tables.length}</span>
              </h2>
              <Button
                variant="outline"
                size="sm"
                disabled={atTableLimit}
                title={
                  atTableLimit ? `A project can have at most ${DATA_LIMITS.tables} tables.` : undefined
                }
                onClick={() => showPanel("new-table")}
              >
                <Plus data-icon="inline-start" />
                New table
              </Button>
            </div>
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
              {tables.map((table) => (
                <li key={table.name}>
                  <button
                    type="button"
                    aria-current={table.name === selected ? "true" : undefined}
                    onClick={() => {
                      setSelected(table.name);
                      setPanel(null);
                    }}
                    className={cn(
                      "flex w-full flex-col gap-1.5 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      table.name === selected ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Table2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{table.name}</span>
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {plural(table.rowCount, "row")} · {plural(table.columns.length, "column")}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      <Badge variant={table.access.create === "everyone" ? "secondary" : "outline"}>
                        Add: {accessLabel(table.access.create)}
                      </Badge>
                      <Badge variant={table.access.read === "everyone" ? "secondary" : "outline"}>
                        Read: {accessLabel(table.access.read)}
                      </Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <section
            aria-label={current ? `Table ${current.name}` : "Table"}
            className={cn(
              "@container/detail min-h-0 min-w-0 flex-1 flex-col",
              covered ? "hidden @4xl/pane:flex" : current ? "flex" : "hidden @2xl/pane:flex",
            )}
          >
            {current ? (
              <TableDetail
                key={current.name}
                projectId={projectId}
                table={current}
                reloadKey={version + reloads}
                hidden={hiddenColumns[current.name] ?? []}
                onHiddenChange={(hidden) =>
                  setHiddenColumns((value) => ({ ...value, [current.name]: hidden }))
                }
                onBack={() => setSelected(null)}
                onAddRow={() => showPanel("add-row")}
                onTableChange={replaceTable}
                onRowsChange={reload}
                onDeleted={() => {
                  setSelected(null);
                  setPanel(null);
                  reload();
                }}
              />
            ) : (
              <p className="m-auto p-6 text-sm text-muted-foreground">Choose a table to see its rows.</p>
            )}
          </section>
        </>
      )}

      {openPanel === "new-table" && (
        <SidePanel title="New table" onClose={closePanel}>
          <NewTableForm
            projectId={projectId}
            onCancel={closePanel}
            onCreated={(table) => {
              setLoaded((value) =>
                value && value.projectId === projectId
                  ? { ...value, tables: [...value.tables, table] }
                  : value,
              );
              setSelected(table.name);
              setPanel(null);
            }}
          />
        </SidePanel>
      )}
      {openPanel === "add-row" && current && (
        <SidePanel title={`Add a row to ${current.name}`} onClose={closePanel}>
          <AddRowForm
            key={current.name}
            projectId={projectId}
            table={current}
            onClose={closePanel}
            onAdded={reload}
          />
        </SidePanel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One table: toolbar, settings and the grid of rows
// ---------------------------------------------------------------------------

interface ImportResult {
  inserted: number;
  skipped: number;
  errors: string[];
}

interface Notice {
  text: string;
  error?: boolean;
  details?: string[];
}

interface TableDetailProps {
  projectId: string;
  table: DataTable;
  /** Changes when the rows should be fetched again. */
  reloadKey: number;
  /** Keys of the grid columns that are switched off. */
  hidden: string[];
  onHiddenChange: (hidden: string[]) => void;
  onBack: () => void;
  onAddRow: () => void;
  onTableChange: (table: DataTable) => void;
  onRowsChange: () => void;
  onDeleted: () => void;
}

function TableDetail({
  projectId,
  table,
  reloadKey,
  hidden,
  onHiddenChange,
  onBack,
  onAddRow,
  onTableChange,
  onRowsChange,
  onDeleted,
}: TableDetailProps) {
  const base = `/api/projects/${projectId}/data/${table.name}`;
  const fileInput = useRef<HTMLInputElement>(null);
  const helpId = useId();
  const [rows, setRows] = useState<DataRow[] | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [retries, setRetries] = useState(0);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [sort, setSort] = useState<Sort | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<"import" | "delete" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api<{ rows: DataRow[]; total: number }>(
      `${base}/rows?limit=${DATA_LIMITS.rows}`,
      "The rows could not be loaded.",
    ).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setRows(result.body.rows);
        setRowsError(null);
      } else {
        setRowsError(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [base, reloadKey, retries]);

  const columns = useMemo(() => gridColumns(table), [table]);
  const visible = columns.filter((column) => !hidden.includes(column.key));
  const sorted = useMemo(
    () => sortRows(rows ?? [], sort, columns.find((column) => column.key === sort?.key)?.type),
    [rows, sort, columns],
  );
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  // Rows can disappear between loads, so count only selected rows that still exist.
  const selectedIds = (rows ?? []).filter((row) => selection.has(row.id)).map((row) => row.id);
  const allOnPage = pageRows.length > 0 && pageRows.every((row) => selection.has(row.id));
  const someOnPage = pageRows.some((row) => selection.has(row.id));

  const toggleRow = (id: string, checked: boolean) => {
    setSelection((value) => {
      const next = new Set(value);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const togglePage = (checked: boolean) => {
    setSelection((value) => {
      const next = new Set(value);
      for (const row of pageRows) {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  };

  /** Unsorted, then ascending, then descending, then unsorted again. */
  const cycleSort = (key: string) => {
    setPage(0);
    setSort((value) =>
      value?.key !== key
        ? { key, direction: "asc" }
        : value.direction === "asc"
          ? { key, direction: "desc" }
          : null,
    );
  };

  const deleteRows = async (ids: string[] | "all") => {
    const question =
      ids === "all"
        ? `Delete every row of "${table.name}" (${plural(rows?.length ?? table.rowCount, "row")})? This can't be undone.`
        : ids.length === 1
          ? "Delete this row? This can't be undone."
          : `Delete ${ids.length} rows? This can't be undone.`;
    if (!window.confirm(question)) return;

    setBusy("delete");
    const result = await api<{ deleted: number }>(
      `${base}/rows`,
      "The rows could not be deleted.",
      jsonRequest("DELETE", { ids }),
    );
    setBusy(null);
    if (!result.ok) {
      setNotice({ text: result.message, error: true });
      return;
    }
    const gone = ids === "all" ? null : new Set(ids);
    setRows((value) => (gone ? (value?.filter((row) => !gone.has(row.id)) ?? value) : []));
    setSelection((value) => new Set(gone ? [...value].filter((id) => !gone.has(id)) : []));
    setNotice(null);
    onRowsChange();
  };

  const importFile = async (file: File) => {
    if (file.size > DATA_LIMITS.csvBytes) {
      setNotice({ text: `${file.name} is larger than 2 MB, the most that can be imported at once.`, error: true });
      return;
    }
    setBusy("import");
    let result: ApiResult<ImportResult>;
    try {
      result = await api<ImportResult>(`${base}/import`, "The file could not be imported.", {
        method: "POST",
        headers: { "content-type": "text/csv" },
        body: await file.text(),
      });
    } catch {
      result = { ok: false, message: `${file.name} could not be read.`, fields: {} };
    }
    setBusy(null);
    if (!result.ok) {
      setNotice({ text: result.message, error: true });
      return;
    }
    const { inserted, skipped, errors } = result.body;
    setNotice({
      text:
        `Imported ${plural(inserted, "row")} from ${file.name}.` +
        (skipped > 0 ? ` Skipped ${plural(skipped, "row")}.` : ""),
      error: inserted === 0 && skipped > 0,
      details: errors,
    });
    if (inserted > 0) onRowsChange();
  };

  const changeAccess = async (key: "create" | "read", value: DataAccess) => {
    if (table.access[key] === value) return;
    // Shown at once; put back if the server refuses.
    onTableChange({ ...table, access: { ...table.access, [key]: value } });
    const result = await api<{ table: DataTable }>(
      base,
      "The setting could not be saved.",
      jsonRequest("PATCH", { access: { [key]: value } }),
    );
    if (result.ok) {
      onTableChange(result.body.table);
    } else {
      onTableChange(table);
      setNotice({ text: result.message, error: true });
    }
  };

  const deleteTable = async () => {
    const question = `Delete the table "${table.name}" and its ${plural(rows?.length ?? table.rowCount, "row")}? This can't be undone.`;
    if (!window.confirm(question)) return;
    const result = await api<{ deleted: boolean }>(base, "The table could not be deleted.", {
      method: "DELETE",
    });
    if (result.ok) onDeleted();
    else setNotice({ text: result.message, error: true });
  };

  return (
    <>
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-3 py-1.5">
        <div className="flex min-w-32 flex-1 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="-ml-1 @2xl/pane:hidden"
            aria-label="All tables"
            title="All tables"
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
          <Table2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h2 className="min-w-0 truncate text-sm font-medium">{table.name}</h2>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {plural(rows?.length ?? table.rowCount, "row")}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {selectedIds.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              disabled={busy !== null}
              onClick={() => void deleteRows(selectedIds)}
            >
              <Trash2 data-icon="inline-start" />
              Delete {selectedIds.length}
              <span className="sr-only"> selected {selectedIds.length === 1 ? "row" : "rows"}</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reload rows"
            title="Reload rows"
            onClick={onRowsChange}
          >
            <RefreshCw />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" aria-label="Columns" title="Show or hide columns" />}
            >
              <Columns3 data-icon="inline-start" />
              <span className="hidden @xl/detail:inline">Columns</span>
              <ChevronDown data-icon="inline-end" className="hidden @xl/detail:block" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                {columns.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.key}
                    checked={!hidden.includes(column.key)}
                    onCheckedChange={(checked) =>
                      onHiddenChange(
                        checked
                          ? hidden.filter((key) => key !== column.key)
                          : [...hidden, column.key],
                      )
                    }
                  >
                    <span className="min-w-0 truncate">{column.key}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            hidden
            aria-label="CSV file to import"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so that choosing the same file again fires a change.
              event.target.value = "";
              if (file) void importFile(file);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            aria-label="Import CSV"
            title="Add rows from a CSV file"
            disabled={busy !== null}
            onClick={() => fileInput.current?.click()}
          >
            {busy === "import" ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <Upload data-icon="inline-start" />
            )}
            <span className="hidden @xl/detail:inline">Import CSV</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Export CSV"
            title="Download every row as a CSV file"
            nativeButton={false}
            render={<a href={`${base}/export`} download={`${table.name}.csv`} />}
          >
            <Download data-icon="inline-start" />
            <span className="hidden @xl/detail:inline">Export CSV</span>
          </Button>
          <Button size="sm" onClick={onAddRow}>
            <Plus data-icon="inline-start" />
            Add row
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label="More actions" title="More actions" />}
            >
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                variant="destructive"
                disabled={busy !== null || !rows || rows.length === 0}
                onClick={() => void deleteRows("all")}
              >
                <Trash2 />
                Delete all rows…
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => void deleteTable()}>
                <Trash2 />
                Delete table…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-3 py-1.5">
        <AccessControl
          label="Who can add rows"
          value={table.access.create}
          onChange={(value) => void changeAccess("create", value)}
        />
        <AccessControl
          label="Who can read rows"
          value={table.access.read}
          onChange={(value) => void changeAccess("read", value)}
        />
        <button
          type="button"
          aria-expanded={helpOpen}
          aria-controls={helpId}
          onClick={() => setHelpOpen((open) => !open)}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", helpOpen && "rotate-90")}
            aria-hidden="true"
          />
          Use from your app
        </button>
        {table.access.read === "everyone" && (
          <p className="w-full text-xs text-amber-700 dark:text-amber-400">
            Anyone who has your app&apos;s link can read every row of this table.
          </p>
        )}
      </div>

      {helpOpen && <ApiHelp id={helpId} projectId={projectId} table={table} />}

      {notice && (
        <div
          role={notice.error ? "alert" : "status"}
          className={cn(
            "flex shrink-0 items-start gap-2 border-b px-3 py-2 text-sm",
            notice.error ? "bg-destructive/5 text-destructive" : "bg-muted/60",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="break-words">{notice.text}</p>
            {notice.details && notice.details.length > 0 && (
              <ul className="mt-1 max-h-28 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-foreground/70">
                {notice.details.map((detail) => (
                  <li key={detail} className="break-words">
                    {detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <X />
          </Button>
        </div>
      )}

      {rows === null ? (
        rowsError ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p role="alert" className="text-sm text-destructive">
              {rowsError}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRowsError(null);
                setRetries((count) => count + 1);
              }}
            >
              <RefreshCw data-icon="inline-start" />
              Try again
            </Button>
          </div>
        ) : (
          <Spinner label="Loading rows" />
        )
      ) : rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-6 text-center">
          <h3 className="text-sm font-medium">No rows yet</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Rows show up here when your app saves them. You can also add one yourself or import a
            CSV file.
          </p>
          <Button variant="outline" size="sm" onClick={onAddRow}>
            <Plus data-icon="inline-start" />
            Add row
          </Button>
        </div>
      ) : (
        <>
          {rowsError && (
            <p role="alert" className="shrink-0 border-b bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {rowsError} Showing the rows loaded earlier.
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
              <caption className="sr-only">Rows of {table.name}</caption>
              <thead>
                <tr>
                  <th scope="col" className={cn(HEAD_CELL, "w-10")}>
                    <input
                      type="checkbox"
                      aria-label="Select all rows on this page"
                      checked={allOnPage}
                      ref={(element) => {
                        if (element) element.indeterminate = someOnPage && !allOnPage;
                      }}
                      onChange={(event) => togglePage(event.target.checked)}
                      className="block size-3.5 accent-foreground"
                    />
                  </th>
                  {visible.map((column) => {
                    const direction = sort?.key === column.key ? sort.direction : null;
                    const SortIcon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ChevronsUpDown;
                    return (
                      <th
                        key={column.key}
                        scope="col"
                        aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
                        className={HEAD_CELL}
                      >
                        <button
                          type="button"
                          title={`Sort by ${column.key}`}
                          onClick={() => cycleSort(column.key)}
                          className={cn(
                            "-mx-1.5 inline-flex h-6 items-center gap-1 rounded-md px-1.5 font-medium outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                            direction && "text-foreground",
                          )}
                        >
                          {column.key}
                          <SortIcon className={cn("size-3", !direction && "opacity-50")} aria-hidden="true" />
                        </button>
                      </th>
                    );
                  })}
                  <th scope="col" className={cn(HEAD_CELL, "w-10")}>
                    <span className="sr-only">Row actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const checked = selection.has(row.id);
                  return (
                    <tr key={row.id} className={cn(checked ? "bg-muted/70" : "hover:bg-muted/40")}>
                      <td className={BODY_CELL}>
                        <input
                          type="checkbox"
                          aria-label={`Select row ${rowLabel(row, table)}`}
                          checked={checked}
                          onChange={(event) => toggleRow(row.id, event.target.checked)}
                          className="block size-3.5 accent-foreground"
                        />
                      </td>
                      {visible.map((column) => (
                        <td key={column.key} className={BODY_CELL}>
                          <GridCell value={cellValue(row, column.key)} type={column.type} />
                        </td>
                      ))}
                      <td className={cn(BODY_CELL, "py-0 text-right")}>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Delete row ${rowLabel(row, table)}`}
                          title="Delete row"
                          disabled={busy !== null}
                          onClick={() => void deleteRows([row.id])}
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="flex h-10 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground tabular-nums">
              <span className="min-w-0 flex-1 truncate" aria-live="polite">
                Rows {currentPage * PAGE_SIZE + 1}–{currentPage * PAGE_SIZE + pageRows.length} of{" "}
                {sorted.length}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous page"
                title="Previous page"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next page"
                title="Next page"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function AccessControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DataAccess;
  onChange: (value: DataAccess) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {/* The group below carries the same words as its accessible name. */}
      <span className="text-xs text-muted-foreground" aria-hidden="true">
        {label}
      </span>
      <Segmented label={label} value={value} options={ACCESS_OPTIONS} onChange={onChange} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Use from your app"
// ---------------------------------------------------------------------------

const SAMPLE_VALUES: Record<ColumnType, string> = {
  text: '"…"',
  number: "1",
  boolean: "true",
  date: '"2026-01-31"',
};

function fetchExample(endpoint: string, columns: DataColumn[]): string {
  // Required fields first, and only a few, to keep the example short.
  const shown = [...columns].sort((a, b) => Number(b.required) - Number(a.required)).slice(0, 4);
  const fields = shown.map((column) => `${column.name}: ${SAMPLE_VALUES[column.type]}`).join(", ");
  return [
    `await fetch("${endpoint}", {`,
    '  method: "POST",',
    '  headers: { "content-type": "application/json" },',
    `  body: JSON.stringify({ ${fields} }),`,
    "});",
  ].join("\n");
}

function ApiHelp({ id, projectId, table }: { id: string; projectId: string; table: DataTable }) {
  const endpoint = `/api/data/${projectId}/${table.name}`;
  const example = fetchExample(endpoint, table.columns);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(example);
      setCopied(true);
    } catch {
      // Copying needs a secure page; the code can still be selected by hand.
    }
  };

  return (
    <div id={id} className="max-h-[45%] shrink-0 space-y-2 overflow-y-auto border-b bg-muted/40 px-3 py-3 text-xs">
      <p className="text-muted-foreground">
        Your app adds a row by sending the fields to this address. It works in the preview and on
        the published site.
      </p>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">Endpoint</span>
        <code className="rounded bg-background px-1.5 py-0.5 font-mono break-all ring-1 ring-border">
          {endpoint}
        </code>
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 font-medium">Example</span>
          <Button variant="outline" size="xs" onClick={() => void copy()}>
            {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
            {copied ? "Copied" : "Copy"}
            <span className="sr-only"> the example code</span>
          </Button>
        </div>
        <pre className="overflow-x-auto rounded-md bg-background p-3 font-mono leading-5 ring-1 ring-border">
          <code>{example}</code>
        </pre>
      </div>
      <p className="text-muted-foreground">
        A plain HTML form that posts to the same address works too: name its inputs after the
        columns.{" "}
        {table.access.create === "owner"
          ? "Adding rows from an app is switched off for this table right now."
          : table.access.read === "everyone"
            ? "A GET request to the same address returns the rows."
            : "Reading rows from an app is switched off for this table."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side panel and its forms
// ---------------------------------------------------------------------------

/**
 * A panel on the right of the pane. On a narrow pane it takes the whole pane
 * over. Focus moves into it when it opens.
 */
function SidePanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("[data-field], input, textarea, select")?.focus();
  }, []);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background @4xl/pane:w-80 @4xl/pane:flex-none @4xl/pane:border-l"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close" title="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      {children}
    </div>
  );
}

interface DraftColumn {
  key: number;
  name: string;
  type: ColumnType;
  required: boolean;
}

/** Nudges typed text toward a valid name: "First Name" becomes "first_name". */
function tidyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 40);
}

function NewTableForm({
  projectId,
  onCancel,
  onCreated,
}: {
  projectId: string;
  onCancel: () => void;
  onCreated: (table: DataTable) => void;
}) {
  const nameId = useId();
  const hintId = useId();
  const nextKey = useRef(1);
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<DraftColumn[]>([
    { key: 0, name: "", type: "text", required: false },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateColumn = (key: number, change: Partial<DraftColumn>) => {
    setColumns((value) => value.map((column) => (column.key === key ? { ...column, ...change } : column)));
  };

  const addColumn = () => {
    const key = nextKey.current;
    nextKey.current += 1;
    setColumns((value) => [...value, { key, name: "", type: "text", required: false }]);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const result = await api<{ table: DataTable }>(
      `/api/projects/${projectId}/data`,
      "The table could not be created.",
      jsonRequest("POST", {
        name,
        columns: columns.map((column) => ({
          name: column.name,
          type: column.type,
          required: column.required,
        })),
      }),
    );
    setSaving(false);
    if (result.ok) onCreated(result.body.table);
    else setError(result.message);
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div className="space-y-1.5">
          <Label htmlFor={nameId}>Table name</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(tidyName(event.target.value))}
            placeholder="contact_messages"
            aria-describedby={hintId}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
          />
          <p id={hintId} className="text-xs text-muted-foreground">
            Lowercase letters, numbers and underscores, starting with a letter.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm leading-none font-medium">Columns</h3>
          <p className="text-xs text-muted-foreground">
            Every row also gets an id and the time it was created.
          </p>
          {columns.map((column, index) => (
            <fieldset key={column.key} className="space-y-2 rounded-lg border p-2">
              <legend className="sr-only">Column {index + 1}</legend>
              <div className="flex items-center gap-1.5">
                <Input
                  value={column.name}
                  onChange={(event) => updateColumn(column.key, { name: tidyName(event.target.value) })}
                  placeholder={index === 0 ? "email" : "column_name"}
                  aria-label={`Name of column ${index + 1}`}
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove column ${index + 1}`}
                  title="Remove column"
                  disabled={columns.length === 1}
                  onClick={() => setColumns((value) => value.filter((item) => item.key !== column.key))}
                >
                  <X />
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={column.type}
                  onChange={(event) => updateColumn(column.key, { type: event.target.value as ColumnType })}
                  aria-label={`Type of column ${index + 1}`}
                  className={cn(FIELD_CLASS, "min-w-0 flex-1")}
                >
                  {COLUMN_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={column.required}
                    onChange={(event) => updateColumn(column.key, { required: event.target.checked })}
                    className="accent-foreground"
                  />
                  Required
                </label>
              </div>
            </fieldset>
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={columns.length >= DATA_LIMITS.columns}
            onClick={addColumn}
          >
            <Plus data-icon="inline-start" />
            Add column
          </Button>
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-t p-3">
        {error && (
          <p role="alert" className="text-sm break-words text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <LoaderCircle data-icon="inline-start" className="animate-spin" />}
            Create table
          </Button>
        </div>
      </div>
    </form>
  );
}

type Draft = Record<string, string | boolean>;

function emptyDraft(columns: DataColumn[]): Draft {
  return Object.fromEntries(columns.map((column) => [column.name, column.type === "boolean" ? false : ""]));
}

function AddRowForm({
  projectId,
  table,
  onClose,
  onAdded,
}: {
  projectId: string;
  table: DataTable;
  onClose: () => void;
  onAdded: () => void;
}) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(table.columns));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [added, setAdded] = useState(0);
  const anyRequired = table.columns.some((column) => column.required);

  const setValue = (name: string, value: string | boolean) => {
    setDraft((current) => ({ ...current, [name]: value }));
  };

  const focusField = (name: string | undefined) => {
    const target = name
      ? formRef.current?.querySelector<HTMLElement>(`[data-field="${name}"]`)
      : formRef.current?.querySelector<HTMLElement>("[data-field]");
    target?.focus();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;

    const values: Record<string, string | boolean> = {};
    for (const column of table.columns) {
      const value = Object.hasOwn(draft, column.name) ? draft[column.name] : "";
      // The picker gives local time with no zone; send the exact moment instead.
      const moment = column.type === "date" && typeof value === "string" && value ? new Date(value) : null;
      values[column.name] = moment && !Number.isNaN(moment.getTime()) ? moment.toISOString() : value;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});
    const result = await api<{ row: DataRow }>(
      `/api/projects/${projectId}/data/${table.name}/rows`,
      "The row could not be added.",
      jsonRequest("POST", values),
    );
    setSaving(false);

    if (result.ok) {
      setDraft(emptyDraft(table.columns));
      setAdded((count) => count + 1);
      onAdded();
      focusField(undefined);
      return;
    }
    setAdded(0);
    const wrong = table.columns.filter((column) => Object.hasOwn(result.fields, column.name));
    if (wrong.length > 0) {
      setFieldErrors(result.fields);
      focusField(wrong[0].name);
    } else {
      setError(result.message);
    }
  };

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {anyRequired && (
          <p className="text-xs text-muted-foreground">
            Fields marked <span className="text-destructive">*</span> are required.
          </p>
        )}
        {table.columns.map((column) => {
          const fieldId = `${formId}-${column.name}`;
          const errorId = `${fieldId}-error`;
          const problem = Object.hasOwn(fieldErrors, column.name) ? fieldErrors[column.name] : undefined;
          const value = Object.hasOwn(draft, column.name) ? draft[column.name] : "";
          const shared = {
            id: fieldId,
            "data-field": column.name,
            required: column.required,
            "aria-invalid": problem ? true : undefined,
            "aria-describedby": problem ? errorId : undefined,
          };
          return (
            <div key={column.name} className="space-y-1.5">
              <Label htmlFor={fieldId}>
                <span className="min-w-0 truncate">{column.name}</span>
                {column.required && (
                  <span className="-ml-1 text-destructive" aria-hidden="true">
                    *
                  </span>
                )}
                <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
                  {TYPE_LABELS[column.type]}
                </span>
              </Label>
              {column.type === "boolean" ? (
                <div className="flex h-8 items-center">
                  <Switch
                    id={fieldId}
                    data-field={column.name}
                    checked={value === true}
                    onCheckedChange={(checked) => setValue(column.name, checked)}
                    aria-invalid={problem ? true : undefined}
                    aria-describedby={problem ? errorId : undefined}
                  />
                </div>
              ) : column.type === "text" ? (
                <Textarea
                  {...shared}
                  rows={1}
                  value={String(value)}
                  onChange={(event) => setValue(column.name, event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  className="max-h-40 min-h-8 resize-none py-1.5"
                />
              ) : (
                <Input
                  {...shared}
                  type={column.type === "number" ? "number" : "datetime-local"}
                  step={column.type === "number" ? "any" : undefined}
                  inputMode={column.type === "number" ? "decimal" : undefined}
                  value={String(value)}
                  onChange={(event) => setValue(column.name, event.target.value)}
                />
              )}
              {problem && (
                <p id={errorId} className="text-xs break-words text-destructive">
                  {problem}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="shrink-0 space-y-2 border-t p-3">
        {error && (
          <p role="alert" className="text-sm break-words text-destructive">
            {error}
          </p>
        )}
        <p role="status" className={cn("text-xs text-muted-foreground", added === 0 && "sr-only")}>
          {added > 0 ? `${plural(added, "row")} added. Add another, or close this panel.` : ""}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {added > 0 ? "Done" : "Cancel"}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <LoaderCircle data-icon="inline-start" className="animate-spin" />}
            Add row
          </Button>
        </div>
      </div>
    </form>
  );
}
