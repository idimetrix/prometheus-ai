"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ColumnInfo {
  defaultValue: string | null;
  isForeignKey: boolean;
  isPrimaryKey: boolean;
  name: string;
  nullable: boolean;
  references?: string;
  type: string;
}

interface TableInfo {
  columns: ColumnInfo[];
  name: string;
  rowCount: number;
}

interface MigrationInfo {
  appliedAt: string | null;
  id: string;
  name: string;
  status: "applied" | "pending";
}

interface QueryResult {
  columns: string[];
  duration: number;
  rowCount: number;
  rows: Record<string, unknown>[];
}

interface DatabasePanelProps {
  className?: string;
  projectId: string;
  sandboxId: string;
}

type TabId = "schema" | "data" | "query" | "migrations" | "diff" | "erd";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "schema", label: "Schema" },
  { id: "data", label: "Data" },
  { id: "query", label: "Query" },
  { id: "migrations", label: "Migrations" },
  { id: "diff", label: "Diff" },
  { id: "erd", label: "ERD" },
];

const ROWS_PER_PAGE = 50;

const READ_ONLY_RE = /^\s*(SELECT|WITH|EXPLAIN|SHOW|DESCRIBE)\b/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isReadOnlyQuery(sql: string): boolean {
  return READ_ONLY_RE.test(sql.trim());
}

function formatType(type: string): string {
  return type.replace(/_/g, " ").toUpperCase();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConnectionIndicator({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`h-2 w-2 rounded-full ${
          connected ? "bg-green-500" : "bg-red-500"
        }`}
      />
      <span className="text-[10px] text-zinc-500">
        {connected ? "Connected" : "Disconnected"}
      </span>
    </div>
  );
}

function SchemaViewer({
  tables,
  selectedTable,
  onSelectTable,
}: {
  tables: TableInfo[];
  selectedTable: string | null;
  onSelectTable: (name: string) => void;
}) {
  const selected = tables.find((t) => t.name === selectedTable);

  return (
    <div className="flex h-full">
      {/* Table list */}
      <div className="w-48 shrink-0 overflow-y-auto border-zinc-800 border-r">
        <div className="px-3 py-2">
          <span className="font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
            Tables ({tables.length})
          </span>
        </div>
        {tables.map((table) => (
          <button
            className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
              table.name === selectedTable
                ? "bg-violet-950/30 text-violet-300"
                : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
            }`}
            key={table.name}
            onClick={() => onSelectTable(table.name)}
            type="button"
          >
            <div className="flex items-center justify-between">
              <span className="truncate font-mono text-xs">{table.name}</span>
              <span className="ml-2 text-[10px] text-zinc-600">
                {table.rowCount}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Column details */}
      <div className="flex-1 overflow-auto p-3">
        {selected ? (
          <div>
            <h3 className="mb-3 font-mono font-semibold text-sm text-zinc-200">
              {selected.name}
            </h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-zinc-800 border-b text-left text-zinc-500">
                  <th className="px-2 py-1.5">Column</th>
                  <th className="px-2 py-1.5">Type</th>
                  <th className="px-2 py-1.5">Nullable</th>
                  <th className="px-2 py-1.5">Default</th>
                  <th className="px-2 py-1.5">Key</th>
                </tr>
              </thead>
              <tbody>
                {selected.columns.map((col) => (
                  <tr
                    className="border-zinc-800/50 border-b text-zinc-300"
                    key={col.name}
                  >
                    <td className="px-2 py-1.5 font-mono">{col.name}</td>
                    <td className="px-2 py-1.5 text-blue-400">
                      {formatType(col.type)}
                    </td>
                    <td className="px-2 py-1.5">
                      {col.nullable ? (
                        <span className="text-yellow-500">YES</span>
                      ) : (
                        <span className="text-zinc-600">NO</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-zinc-500">
                      {col.defaultValue ?? "-"}
                    </td>
                    <td className="px-2 py-1.5">
                      {col.isPrimaryKey && (
                        <span className="rounded bg-amber-900/30 px-1 py-0.5 text-[10px] text-amber-400">
                          PK
                        </span>
                      )}
                      {col.isForeignKey && (
                        <span
                          className="rounded bg-blue-900/30 px-1 py-0.5 text-[10px] text-blue-400"
                          title={col.references}
                        >
                          FK
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            Select a table to view its schema
          </div>
        )}
      </div>
    </div>
  );
}

function DataViewer({
  rows,
  columns,
  page,
  totalRows,
  onPageChange,
  sortColumn,
  sortDirection,
  onSort,
}: {
  rows: Record<string, unknown>[];
  columns: string[];
  page: number;
  totalRows: number;
  onPageChange: (page: number) => void;
  sortColumn: string | null;
  sortDirection: "asc" | "desc";
  onSort: (column: string) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalRows / ROWS_PER_PAGE));

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-zinc-900">
            <tr className="border-zinc-800 border-b text-left text-zinc-500">
              {columns.map((col) => (
                <th className="px-2 py-1.5" key={col}>
                  <button
                    className="flex items-center gap-1 hover:text-zinc-300"
                    onClick={() => onSort(col)}
                    type="button"
                  >
                    {col}
                    {sortColumn === col && (
                      <span>{sortDirection === "asc" ? "^" : "v"}</span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, _idx) => (
              <tr
                className="border-zinc-800/50 border-b text-zinc-300 hover:bg-zinc-800/30"
                key={`row-${columns.map((c) => String(row[c] ?? "")).join("-")}`}
              >
                {columns.map((col) => (
                  <td
                    className="max-w-48 truncate px-2 py-1 font-mono"
                    key={col}
                  >
                    {row[col] === null ? (
                      <span className="text-zinc-600 italic">NULL</span>
                    ) : (
                      String(row[col])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between border-zinc-800 border-t px-3 py-2">
        <span className="text-[10px] text-zinc-500">
          {totalRows} rows total
        </span>
        <div className="flex items-center gap-2">
          <button
            className="rounded px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            type="button"
          >
            Prev
          </button>
          <span className="text-[10px] text-zinc-500">
            {page} / {totalPages}
          </span>
          <button
            className="rounded px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            type="button"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function QueryInput({
  onExecute,
  result,
  isRunning,
}: {
  onExecute: (sql: string) => void;
  result: QueryResult | null;
  isRunning: boolean;
}) {
  const [query, setQuery] = useState("SELECT 1;");
  const [error, setError] = useState<string | null>(null);

  const handleExecute = useCallback(() => {
    setError(null);
    if (!isReadOnlyQuery(query)) {
      setError(
        "Only read-only queries (SELECT, WITH, EXPLAIN, SHOW, DESCRIBE) are allowed for safety."
      );
      return;
    }
    onExecute(query);
  }, [query, onExecute]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-zinc-800 border-b p-3">
        <textarea
          className="w-full rounded border border-zinc-700 bg-zinc-900 p-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-600 focus:outline-none"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter a read-only SQL query..."
          rows={4}
          value={query}
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            className="rounded bg-violet-600 px-3 py-1.5 font-medium text-white text-xs transition-colors hover:bg-violet-500 disabled:opacity-50"
            disabled={isRunning || !query.trim()}
            onClick={handleExecute}
            type="button"
          >
            {isRunning ? "Running..." : "Execute"}
          </button>
          <span className="text-[10px] text-zinc-500">
            Read-only queries only
          </span>
        </div>
        {error && (
          <div className="mt-2 rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-red-400 text-xs">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto p-3">
        {result ? (
          <div>
            <div className="mb-2 flex items-center gap-3 text-[10px] text-zinc-500">
              <span>{result.rowCount} rows</span>
              <span>{result.duration}ms</span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-zinc-800 border-b text-left text-zinc-500">
                  {result.columns.map((col) => (
                    <th className="px-2 py-1.5" key={col}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, _idx) => (
                  <tr
                    className="border-zinc-800/50 border-b text-zinc-300"
                    key={`qr-${result.columns.map((c) => String(row[c] ?? "")).join("-")}`}
                  >
                    {result.columns.map((col) => (
                      <td className="px-2 py-1 font-mono" key={col}>
                        {row[col] === null ? (
                          <span className="text-zinc-600 italic">NULL</span>
                        ) : (
                          String(row[col])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            Execute a query to see results
          </div>
        )}
      </div>
    </div>
  );
}

function MigrationList({
  migrations,
  onGenerate,
}: {
  migrations: MigrationInfo[];
  onGenerate: () => void;
}) {
  return (
    <div className="p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-medium text-sm text-zinc-200">Migrations</span>
        <button
          className="rounded border border-violet-800/50 bg-violet-950/30 px-3 py-1.5 font-medium text-violet-400 text-xs transition-colors hover:bg-violet-900/40"
          onClick={onGenerate}
          type="button"
        >
          Generate Migration
        </button>
      </div>
      <div className="space-y-1">
        {migrations.map((m) => (
          <div
            className="flex items-center justify-between rounded border border-zinc-800 px-3 py-2"
            key={m.id}
          >
            <div className="flex items-center gap-2">
              <div
                className={`h-2 w-2 rounded-full ${
                  m.status === "applied" ? "bg-green-500" : "bg-yellow-500"
                }`}
              />
              <span className="font-mono text-xs text-zinc-300">{m.name}</span>
            </div>
            <span className="text-[10px] text-zinc-500">
              {m.status === "applied" && m.appliedAt
                ? `Applied ${m.appliedAt}`
                : "Pending"}
            </span>
          </div>
        ))}
        {migrations.length === 0 && (
          <div className="py-8 text-center text-sm text-zinc-600">
            No migrations found
          </div>
        )}
      </div>
    </div>
  );
}

function SchemaDiff({ diff }: { diff: string }) {
  return (
    <div className="p-3">
      <h3 className="mb-3 font-medium text-sm text-zinc-200">
        Schema vs Last Migration
      </h3>
      {diff ? (
        <pre className="overflow-auto rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs text-zinc-300">
          {diff}
        </pre>
      ) : (
        <div className="py-8 text-center text-sm text-zinc-600">
          Schema is up to date with the latest migration
        </div>
      )}
    </div>
  );
}

function ErdDiagram({ tables }: { tables: TableInfo[] }) {
  const relationships = useMemo(() => {
    const rels: Array<{ from: string; to: string; column: string }> = [];
    for (const table of tables) {
      for (const col of table.columns) {
        if (col.isForeignKey && col.references) {
          rels.push({
            from: table.name,
            to: col.references.split(".")[0] ?? col.references,
            column: col.name,
          });
        }
      }
    }
    return rels;
  }, [tables]);

  return (
    <div className="overflow-auto p-3">
      <h3 className="mb-3 font-medium text-sm text-zinc-200">
        Entity Relationships
      </h3>
      <div className="flex flex-wrap gap-4">
        {tables.map((table) => (
          <div
            className="w-56 rounded border border-zinc-700 bg-zinc-900"
            key={table.name}
          >
            <div className="border-zinc-700 border-b bg-zinc-800 px-3 py-2">
              <span className="font-mono font-semibold text-xs text-zinc-200">
                {table.name}
              </span>
            </div>
            <div className="p-2">
              {table.columns.slice(0, 8).map((col) => (
                <div
                  className="flex items-center justify-between py-0.5"
                  key={col.name}
                >
                  <span className="font-mono text-[10px] text-zinc-400">
                    {col.isPrimaryKey ? "* " : ""}
                    {col.name}
                  </span>
                  <span className="text-[10px] text-zinc-600">{col.type}</span>
                </div>
              ))}
              {table.columns.length > 8 && (
                <div className="pt-1 text-[10px] text-zinc-600">
                  +{table.columns.length - 8} more
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {relationships.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 font-medium text-xs text-zinc-400">
            Relationships
          </h4>
          <div className="space-y-1">
            {relationships.map((rel) => (
              <div
                className="text-[10px] text-zinc-500"
                key={`${rel.from}-${rel.column}-${rel.to}`}
              >
                <span className="font-mono text-zinc-300">{rel.from}</span>
                {"."}
                <span className="text-blue-400">{rel.column}</span>
                {" -> "}
                <span className="font-mono text-zinc-300">{rel.to}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function DatabasePanel({
  className,
  projectId: _projectId,
  sandboxId: _sandboxId,
}: DatabasePanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("schema");
  const [connected, setConnected] = useState(false);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [dataRows, setDataRows] = useState<Record<string, unknown>[]>([]);
  const [dataColumns, setDataColumns] = useState<string[]>([]);
  const [dataPage, setDataPage] = useState(1);
  const [dataTotalRows, setDataTotalRows] = useState(0);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [migrations, setMigrations] = useState<MigrationInfo[]>([]);
  const [schemaDiff, _setSchemaDiff] = useState("");

  // Simulate connection check
  useEffect(() => {
    const timer = setTimeout(() => setConnected(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // Load mock schema data on mount
  useEffect(() => {
    if (!connected) {
      return;
    }

    const mockTables: TableInfo[] = [
      {
        name: "projects",
        rowCount: 42,
        columns: [
          {
            name: "id",
            type: "text",
            nullable: false,
            defaultValue: null,
            isPrimaryKey: true,
            isForeignKey: false,
          },
          {
            name: "org_id",
            type: "text",
            nullable: false,
            defaultValue: null,
            isPrimaryKey: false,
            isForeignKey: true,
            references: "organizations.id",
          },
          {
            name: "name",
            type: "text",
            nullable: false,
            defaultValue: null,
            isPrimaryKey: false,
            isForeignKey: false,
          },
          {
            name: "status",
            type: "text",
            nullable: false,
            defaultValue: "'setup'",
            isPrimaryKey: false,
            isForeignKey: false,
          },
          {
            name: "created_at",
            type: "timestamptz",
            nullable: false,
            defaultValue: "now()",
            isPrimaryKey: false,
            isForeignKey: false,
          },
        ],
      },
      {
        name: "sessions",
        rowCount: 128,
        columns: [
          {
            name: "id",
            type: "text",
            nullable: false,
            defaultValue: null,
            isPrimaryKey: true,
            isForeignKey: false,
          },
          {
            name: "project_id",
            type: "text",
            nullable: false,
            defaultValue: null,
            isPrimaryKey: false,
            isForeignKey: true,
            references: "projects.id",
          },
          {
            name: "status",
            type: "text",
            nullable: false,
            defaultValue: "'active'",
            isPrimaryKey: false,
            isForeignKey: false,
          },
        ],
      },
      {
        name: "tasks",
        rowCount: 256,
        columns: [
          {
            name: "id",
            type: "text",
            nullable: false,
            defaultValue: null,
            isPrimaryKey: true,
            isForeignKey: false,
          },
          {
            name: "session_id",
            type: "text",
            nullable: false,
            defaultValue: null,
            isPrimaryKey: false,
            isForeignKey: true,
            references: "sessions.id",
          },
          {
            name: "title",
            type: "text",
            nullable: false,
            defaultValue: null,
            isPrimaryKey: false,
            isForeignKey: false,
          },
        ],
      },
    ];

    setTables(mockTables);
    setMigrations([
      {
        id: "001",
        name: "0001_initial_schema",
        appliedAt: "2025-11-01",
        status: "applied",
      },
      {
        id: "002",
        name: "0002_add_sessions",
        appliedAt: "2025-11-15",
        status: "applied",
      },
      {
        id: "003",
        name: "0003_add_ssh_keys",
        appliedAt: null,
        status: "pending",
      },
    ]);
  }, [connected]);

  const handleSelectTable = useCallback(
    (name: string) => {
      setSelectedTable(name);
      if (activeTab === "data") {
        setDataPage(1);
        const table = tables.find((t) => t.name === name);
        if (table) {
          setDataColumns(table.columns.map((c) => c.name));
          setDataTotalRows(table.rowCount);
          setDataRows([]);
        }
      }
    },
    [activeTab, tables]
  );

  const handleSort = useCallback(
    (column: string) => {
      if (sortColumn === column) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortColumn(column);
        setSortDirection("asc");
      }
    },
    [sortColumn]
  );

  const handleExecuteQuery = useCallback((_sql: string) => {
    setIsRunning(true);
    // Simulate query execution
    setTimeout(() => {
      setQueryResult({
        columns: ["result"],
        rows: [{ result: 1 }],
        rowCount: 1,
        duration: 12,
      });
      setIsRunning(false);
    }, 300);
  }, []);

  const handleGenerateMigration = useCallback(() => {
    // Placeholder: would trigger AI migration generation via the orchestrator
  }, []);

  return (
    <div className={`flex h-full flex-col bg-zinc-950 ${className ?? ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="font-medium text-xs text-zinc-400 uppercase tracking-wider">
            Database
          </span>
          <ConnectionIndicator connected={connected} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-zinc-800 border-b">
        {TABS.map((tab) => (
          <button
            className={`px-3 py-1.5 text-xs transition-colors ${
              activeTab === tab.id
                ? "border-violet-500 border-b-2 text-violet-300"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "schema" && (
          <SchemaViewer
            onSelectTable={handleSelectTable}
            selectedTable={selectedTable}
            tables={tables}
          />
        )}
        {activeTab === "data" && (
          <DataViewer
            columns={dataColumns}
            onPageChange={setDataPage}
            onSort={handleSort}
            page={dataPage}
            rows={dataRows}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            totalRows={dataTotalRows}
          />
        )}
        {activeTab === "query" && (
          <QueryInput
            isRunning={isRunning}
            onExecute={handleExecuteQuery}
            result={queryResult}
          />
        )}
        {activeTab === "migrations" && (
          <MigrationList
            migrations={migrations}
            onGenerate={handleGenerateMigration}
          />
        )}
        {activeTab === "diff" && <SchemaDiff diff={schemaDiff} />}
        {activeTab === "erd" && <ErdDiagram tables={tables} />}
      </div>
    </div>
  );
}
