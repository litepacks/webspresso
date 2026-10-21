'use strict';

/**
 * Modern Web UI for Webspresso DB Studio
 * Built with Tailwind CSS v4 and Native Declarative EUIX Engine (<api_config>, <api_endpoint>, <watch>)
 * @module core/studio/ui
 */

function renderStudioHtml() {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Webspresso DB Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  
  <!-- Tailwind CSS v4 Browser Runtime -->
  <script src="https://unpkg.com/@tailwindcss/browser@4"></script>
  
  <!-- EUIX Engine (Litepacks Declarative Reactive UI Engine with SWR API Client) -->
  <script src="https://unpkg.com/euixjs@latest/dist/EUIXEngine.umd.js"></script>

  <style>
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
    }
    .font-mono {
      font-family: 'JetBrains Mono', monospace;
    }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #090d16; }
    ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #334155; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 flex h-screen overflow-hidden selection:bg-indigo-500/30 selection:text-indigo-200">

  <!-- EUIX Mount Target -->
  <div id="app" class="flex h-screen w-screen overflow-hidden"></div>

  <!-- 100% Declarative EUIX Application Specification -->
  <script type="application/euix" target="#app" id="euix-studio-spec">
  <uid_spec>
    <!-- Declarative REST SWR API Configuration -->
    <api_config base_url="/_studio/api">
      <!-- 1. Auto-fetch all database tables on mount -->
      <api_endpoint
        id="get_tables"
        tag="get_tables"
        url="/tables"
        method="GET"
        bind_target="tables"
        auto_fetch="true"
        loading="isLoadingTables"
      />

      <!-- 2. On-demand Table Schema inspection -->
      <api_endpoint
        id="get_schema"
        tag="get_schema"
        url="/tables/{data.activeTable}/schema"
        method="GET"
        bind_target="columns"
        auto_fetch="false"
        loading="isLoadingSchema"
      />

      <!-- 3. On-demand Paginated Rows fetching -->
      <api_endpoint
        id="get_rows"
        tag="get_rows"
        url="/tables/{data.activeTable}/rows?page={data.page}&amp;limit={data.limit}"
        method="GET"
        bind_target="tableResult"
        auto_fetch="false"
        loading="isLoadingRows"
      />

      <!-- 4. Raw SQL Query Execution -->
      <api_endpoint
        id="run_query"
        tag="run_query"
        url="/query"
        method="POST"
        bind_target="sqlResult"
        auto_fetch="false"
        loading="isLoadingSql"
      >
        <body>{"sql": "{data.sqlQuery}"}</body>
      </api_endpoint>

      <!-- 5. Live Telemetry & Metrics -->
      <api_endpoint
        id="get_telemetry"
        tag="get_telemetry"
        url="/telemetry"
        method="GET"
        bind_target="telemetry"
        auto_fetch="true"
        loading="isLoadingTelemetry"
      />
    </api_config>

    <!-- Central EUIX Reactive Data Model -->
    <data_model>
      <state id="tables" type="array">[]</state>
      <state id="filterQuery" type="string"></state>
      <state id="activeTable" type="string"></state>
      <state id="activeTab" type="string">data</state>
      <state id="columns" type="array">[]</state>
      <state id="tableResult" type="object">{"rows": [], "total": 0, "totalPages": 1}</state>
      <state id="page" type="number">1</state>
      <state id="limit" type="number">25</state>
      <state id="pkField" type="string">id</state>
      <state id="isLoadingTables" type="boolean">false</state>
      <state id="isLoadingSchema" type="boolean">false</state>
      <state id="isLoadingRows" type="boolean">false</state>
      <state id="isLoadingSql" type="boolean">false</state>
      <state id="sqlQuery" type="string">SELECT * FROM sqlite_master LIMIT 10;</state>
      <state id="sqlResult" type="object">{"rows": [], "durationMs": 0}</state>
      <state id="isModalOpen" type="boolean">false</state>
      <state id="modalMode" type="string">insert</state>
      <state id="modalRecordId" type="string"></state>
      <state id="newRowJson" type="string">{}</state>
      <state id="telemetry" type="object">{"memory":{"heapUsedMb":0,"heapTotalMb":0,"rssMb":0,"externalMb":0},"pool":{"used":0,"free":0,"pending":0,"client":""},"breakers":[],"queue":{"enabled":false},"uptimeSeconds":0,"nodeVersion":""}</state>
      <state id="isLoadingTelemetry" type="boolean">false</state>

      <!-- Declarative Watchers for Automatic Reactive HTTP Revalidation -->
      <watch path="activeTable">
        <step action="SET_STATE">
          <path>data.page</path>
          <value>1</value>
        </step>
        <step action="REVALIDATE_API" tag="get_schema" />
        <step action="REVALIDATE_API" tag="get_rows" />
      </watch>

      <watch path="page">
        <step action="REVALIDATE_API" tag="get_rows" />
      </watch>
    </data_model>

    <div class="flex h-full w-full overflow-hidden">
      <!-- Reactive Sidebar -->
      <aside class="w-72 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        <!-- Brand Header -->
        <div class="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50 backdrop-blur">
          <div class="flex items-center gap-2.5">
            <span class="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20 text-sm">⚡</span>
            <div>
              <h1 class="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
                Webspresso <span class="text-[10px] font-semibold bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/30">Studio</span>
              </h1>
              <p class="text-[11px] text-slate-400">Database Inspector &amp; Runner</p>
            </div>
          </div>
        </div>

        <!-- EUIX Engine SWR Badge -->
        <div class="px-4 py-2 bg-slate-950/40 border-b border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
          <div class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full {data.isLoadingTables || data.isLoadingRows ? 'bg-amber-400 animate-ping' : 'bg-emerald-400 animate-pulse'}"></span>
            <span class="font-medium text-slate-300">EUIX Engine</span>
          </div>
          <span class="font-mono text-indigo-400 font-semibold">{data.tables.length} Tables</span>
        </div>

        <!-- Two-Way Bound Search Input -->
        <div class="p-3 border-b border-slate-800">
          <input bind="filterQuery" placeholder="Filter tables..."
            class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition" />
        </div>

        <!-- Declarative Tables List with Keyed Reconciliation -->
        <div class="flex-1 overflow-y-auto p-2 space-y-1">
          <if condition="data.tables.length === 0">
            <div class="p-4 text-center text-xs text-slate-500">
              {data.isLoadingTables ? 'Loading tables...' : 'No tables found'}
            </div>
          </if>
          <for_each items="{data.tables}" var="t" key="name">
            <if condition="!data.filterQuery || t.name.toLowerCase().includes(data.filterQuery.toLowerCase())">
              <div class="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition {data.activeTable == t.name ? 'bg-indigo-600 text-white font-semibold shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'}">
                <!-- Setting activeTable automatically triggers <watch path="activeTable"> to fetch schema & rows -->
                <on_click action="SET_STATE">
                  <path>data.activeTable</path>
                  <value>{t.name}</value>
                </on_click>
                <span class="truncate">{t.name}</span>
                <span class="font-mono text-[10px] px-1.5 py-0.5 rounded-full {data.activeTable == t.name ? 'bg-indigo-700/60 text-indigo-100' : 'bg-slate-800 text-slate-400'}">{t.count}</span>
              </div>
            </if>
          </for_each>
        </div>

        <!-- Sidebar Footer -->
        <div class="p-3 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between bg-slate-950/20">
          <div class="flex items-center gap-1.5">
            <span class="text-indigo-400 font-semibold">Tailwind 4</span>
            <span>&bull;</span>
            <span class="text-emerald-400 font-semibold">Declarative EUIX</span>
          </div>
          <span class="font-mono text-slate-400">v0.0.105</span>
        </div>
      </aside>

      <!-- Main Content Area -->
      <main class="flex-1 flex flex-col overflow-hidden bg-slate-950">
        <!-- Header -->
        <header class="h-14 px-6 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-4 shrink-0">
          <div class="flex items-center gap-4">
            <div class="flex items-center gap-2.5">
              <span class="text-base font-bold font-mono text-white">{data.activeTable ? data.activeTable : 'Select a table'}</span>
              <if condition="data.activeTable">
                <span class="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">{data.tableResult.total || 0} rows</span>
              </if>
            </div>

            <!-- Tab Switching using Declarative on_click:set Shorthands -->
            <nav class="flex gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button class="px-3 py-1 text-xs font-semibold rounded-md transition {data.activeTab == 'data' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}">
                <on_click action="SET_STATE">
                  <path>data.activeTab</path>
                  <value>data</value>
                </on_click>
                Table Data
              </button>
              <button class="px-3 py-1 text-xs font-semibold rounded-md transition {data.activeTab == 'sql' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}">
                <on_click action="SET_STATE">
                  <path>data.activeTab</path>
                  <value>sql</value>
                </on_click>
                SQL Query
              </button>
              <button class="px-3 py-1 text-xs font-semibold rounded-md transition {data.activeTab == 'telemetry' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}">
                <on_click action="SET_STATE">
                  <path>data.activeTab</path>
                  <value>telemetry</value>
                </on_click>
                <on_click action="REVALIDATE_API" tag="get_telemetry" />
                Live Telemetry
              </button>
            </nav>
          </div>

          <div class="flex items-center gap-2">
            <!-- Declarative SWR Revalidate Action -->
            <button class="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition flex items-center gap-1.5 shadow-sm">
              <on_click action="REVALIDATE_API" tag="get_tables" />
              <on_click action="REVALIDATE_API" tag="get_rows" />
              <on_click action="REVALIDATE_API" tag="get_telemetry" />
              <span>↻</span> Refresh
            </button>
            <if condition="data.activeTable">
              <button class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition flex items-center gap-1.5 shadow-sm shadow-indigo-600/30">
                <on_click action="SET_STATE">
                  <path>data.modalMode</path>
                  <value>insert</value>
                </on_click>
                <on_click action="SET_STATE">
                  <path>data.newRowJson</path>
                  <value>{}</value>
                </on_click>
                <on_click action="SET_STATE">
                  <path>data.isModalOpen</path>
                  <value>true</value>
                </on_click>
                <span>+</span> New Record
              </button>
            </if>
          </div>
        </header>

        <!-- View 1: Table Data View -->
        <if condition="data.activeTab == 'data'">
          <section class="flex-1 flex flex-col overflow-hidden p-6 gap-4">
            <div class="flex-1 bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow-xl shadow-black/40">
              
              <!-- When No Table is Selected -->
              <if condition="!data.activeTable">
                <div class="flex-1 flex items-center justify-center p-12 text-center text-slate-500 text-sm">
                  <div>
                    <div class="text-3xl mb-2">⚡</div>
                    <p class="font-medium text-slate-400">Select a table from the sidebar</p>
                    <p class="text-xs text-slate-600 mt-1">Explore schema, browse paginated records, insert or edit rows</p>
                  </div>
                </div>
              </if>

              <!-- When a Table is Selected -->
              <if condition="data.activeTable">
                <div class="flex-1 overflow-auto">
                  <table class="w-full text-left text-xs border-collapse">
                    <thead class="sticky top-0 bg-slate-900 border-b border-slate-800 z-10 font-mono text-slate-400 text-[11px]">
                      <tr class="border-b border-slate-800">
                        <for_each items="{data.columns}" var="c" key="name">
                          <th class="px-4 py-3 whitespace-nowrap">
                            {c.name} {c.isPrimaryKey ? '🔑' : ''}
                            <span class="text-[10px] text-slate-500 font-normal">({c.type})</span>
                          </th>
                        </for_each>
                        <th class="px-4 py-3 text-right w-24 whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-800/60 font-mono text-slate-300">
                      <if condition="!data.tableResult.rows || data.tableResult.rows.length === 0">
                        <tr>
                          <td class="text-center py-16 text-slate-500 font-sans" colspan="100">
                            {data.isLoadingRows ? 'Loading records...' : 'No records found in this table'}
                          </td>
                        </tr>
                      </if>
                      <for_each items="{data.tableResult.rows}" var="row" key="id">
                        <tr class="hover:bg-slate-850 transition">
                          <for_each items="{data.columns}" var="col" key="name">
                            <td class="px-4 py-2.5 whitespace-nowrap text-slate-300">
                              {row[col.name] === null ? 'null' : (typeof row[col.name] === 'object' ? JSON.stringify(row[col.name]) : String(row[col.name]))}
                            </td>
                          </for_each>
                          <td class="px-4 py-2.5 text-right whitespace-nowrap">
                            <div class="flex items-center justify-end gap-1">
                              <!-- Declarative Delete with Native XHR and automatic Revalidation -->
                              <button class="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition text-xs">
                                <on_click action="XHR" confirm="Are you sure you want to delete this record?">
                                  <url>/_studio/api/tables/{data.activeTable}/rows/{row[data.pkField || 'id']}?pk={data.pkField || 'id'}</url>
                                  <method>DELETE</method>
                                  <step action="REVALIDATE_API" tag="get_tables" />
                                  <step action="REVALIDATE_API" tag="get_rows" />
                                </on_click>
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      </for_each>
                    </tbody>
                  </table>
                </div>

                <!-- Declarative Pagination Controls -->
                <div class="h-12 px-4 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono shrink-0">
                  <div>Showing {data.tableResult.rows ? data.tableResult.rows.length : 0} of {data.tableResult.total || 0} records</div>
                  <div class="flex items-center gap-2">
                    <button class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition" disabled="{data.page <= 1}">
                      <on_click action="SET_STATE">
                        <path>data.page</path>
                        <value>{data.page - 1}</value>
                      </on_click>
                      Prev
                    </button>
                    <span class="px-2 font-bold text-white">Page {data.page} of {data.tableResult.totalPages || 1}</span>
                    <button class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition" disabled="{data.page >= (data.tableResult.totalPages || 1)}">
                      <on_click action="SET_STATE">
                        <path>data.page</path>
                        <value>{data.page + 1}</value>
                      </on_click>
                      Next
                    </button>
                  </div>
                </div>
              </if>
            </div>
          </section>
        </if>

        <!-- View 2: SQL Console View -->
        <if condition="data.activeTab == 'sql'">
          <section class="flex-1 flex flex-col overflow-hidden p-6 gap-4">
            <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-lg shrink-0">
              <div class="flex items-center justify-between">
                <span class="text-xs font-mono font-semibold text-slate-300">Raw SQL Editor</span>
                <div class="flex items-center gap-1.5">
                  <span class="text-[11px] text-slate-500">Quick:</span>
                  <button class="text-[10px] text-slate-400 hover:text-indigo-300 font-mono px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 transition">
                    <on_click action="SET_STATE">
                      <path>data.sqlQuery</path>
                      <value>SELECT * FROM {data.activeTable || 'sqlite_master'} LIMIT 25;</value>
                    </on_click>
                    SELECT 25
                  </button>
                  <button class="text-[10px] text-slate-400 hover:text-indigo-300 font-mono px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 transition">
                    <on_click action="SET_STATE">
                      <path>data.sqlQuery</path>
                      <value>SELECT COUNT(*) AS total FROM {data.activeTable || 'sqlite_master'};</value>
                    </on_click>
                    COUNT(*)
                  </button>
                </div>
              </div>
              <textarea bind="sqlQuery" placeholder="SELECT * FROM sqlite_master LIMIT 10;"
                class="w-full h-28 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition resize-y"></textarea>
              <div class="flex items-center justify-between">
                <span class="text-xs font-mono text-slate-400">
                  {data.isLoadingSql ? 'Executing query...' : (data.sqlResult.durationMs ? '✓ Executed in ' + data.sqlResult.durationMs + 'ms (' + (data.sqlResult.rows ? data.sqlResult.rows.length : 0) + ' rows)' : '')}
                </span>
                <!-- Declarative SQL Revalidate Action -->
                <button class="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition flex items-center gap-1.5 shadow-sm shadow-indigo-600/30">
                  <on_click action="REVALIDATE_API" tag="run_query" />
                  <span>▶</span> Run Query
                </button>
              </div>
            </div>

            <div class="flex-1 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-xl shadow-black/40">
              <div class="flex-1 overflow-auto">
                <table class="w-full text-left text-xs border-collapse">
                  <tbody class="divide-y divide-slate-800/60 font-mono text-slate-300">
                    <if condition="!data.sqlResult.rows || data.sqlResult.rows.length === 0">
                      <tr>
                        <td class="text-center py-16 text-slate-500 font-sans" colspan="100">
                          {data.isLoadingSql ? 'Executing query...' : 'Enter a SQL query above and click "Run Query"'}
                        </td>
                      </tr>
                    </if>
                    <for_each items="{data.sqlResult.rows}" var="r" key="_idx">
                      <tr class="hover:bg-slate-850 transition">
                        <td class="px-4 py-2.5 whitespace-nowrap text-slate-300">{JSON.stringify(r)}</td>
                      </tr>
                    </for_each>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </if>

        <!-- View 3: Live Telemetry & Queue Dashboard -->
        <if condition="data.activeTab == 'telemetry'">
          <section class="flex-1 flex flex-col overflow-y-auto p-6 gap-6">
            <!-- Top Metric Cards Grid -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
              <!-- Memory (Heap Used / Total) -->
              <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg shadow-black/30">
                <div class="flex items-center justify-between text-xs text-slate-400 font-mono mb-2">
                  <span>RAM (Heap Used)</span>
                  <span class="text-indigo-400 font-bold">{data.telemetry.memory.heapUsedMb || 0} MB</span>
                </div>
                <div class="text-2xl font-bold font-mono text-white mb-2">
                  {data.telemetry.memory.heapUsedMb || 0} <span class="text-xs font-normal text-slate-400">/ {data.telemetry.memory.heapTotalMb || 0} MB</span>
                </div>
                <div class="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                  <div class="bg-indigo-500 h-1.5 rounded-full" style="width: 45%;"></div>
                </div>
                <div class="mt-2 text-[10px] text-slate-500 font-mono flex justify-between">
                  <span>RSS: {data.telemetry.memory.rssMb || 0} MB</span>
                  <span>Ext: {data.telemetry.memory.externalMb || 0} MB</span>
                </div>
              </div>

              <!-- Database Connection Pool -->
              <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg shadow-black/30">
                <div class="flex items-center justify-between text-xs text-slate-400 font-mono mb-2">
                  <span>DB Pool ({data.telemetry.pool.client || 'Knex'})</span>
                  <span class="text-emerald-400 font-bold">{data.telemetry.pool.used || 0} Active</span>
                </div>
                <div class="text-2xl font-bold font-mono text-white mb-2">
                  {data.telemetry.pool.used || 0} <span class="text-xs font-normal text-slate-400">active / {data.telemetry.pool.free || 0} free</span>
                </div>
                <div class="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                  <div class="bg-emerald-500 h-1.5 rounded-full" style="width: 30%;"></div>
                </div>
                <div class="mt-2 text-[10px] text-slate-500 font-mono flex justify-between">
                  <span>Pending Acquires: {data.telemetry.pool.pending || 0}</span>
                  <span class="text-emerald-400">Connected</span>
                </div>
              </div>

              <!-- Background Queue Status -->
              <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg shadow-black/30">
                <div class="flex items-center justify-between text-xs text-slate-400 font-mono mb-2">
                  <span>Queue Workers</span>
                  <span class="{data.telemetry.queue.enabled ? (data.telemetry.queue.isPaused ? 'text-amber-400' : 'text-emerald-400') : 'text-slate-500'} font-bold">
                    {data.telemetry.queue.enabled ? (data.telemetry.queue.isPaused ? 'Paused' : 'Active') : 'Disabled'}
                  </span>
                </div>
                <div class="text-2xl font-bold font-mono text-white mb-2">
                  {data.telemetry.queue.activeWorkers || 0} <span class="text-xs font-normal text-slate-400">workers / {data.telemetry.queue.concurrency || 2} max</span>
                </div>
                <div class="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                  <div class="bg-amber-500 h-1.5 rounded-full" style="width: 20%;"></div>
                </div>
                <div class="mt-2 text-[10px] text-slate-500 font-mono flex justify-between">
                  <span>Jobs Registered: {data.telemetry.queue.registeredJobs ? data.telemetry.queue.registeredJobs.length : 0}</span>
                  <span>Waiting: {data.telemetry.queue.waiting || 0}</span>
                </div>
              </div>

              <!-- Runtime & System -->
              <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg shadow-black/30">
                <div class="flex items-center justify-between text-xs text-slate-400 font-mono mb-2">
                  <span>Node.js Process</span>
                  <span class="text-indigo-400 font-bold">PID {data.telemetry.pid || 0}</span>
                </div>
                <div class="text-2xl font-bold font-mono text-white mb-2">
                  {data.telemetry.uptimeSeconds || 0} <span class="text-xs font-normal text-slate-400">sec uptime</span>
                </div>
                <div class="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                  <div class="bg-indigo-400 h-1.5 rounded-full" style="width: 100%;"></div>
                </div>
                <div class="mt-2 text-[10px] text-slate-500 font-mono flex justify-between">
                  <span>Node: {data.telemetry.nodeVersion || 'v20'}</span>
                  <span class="text-emerald-400">SSE Active</span>
                </div>
              </div>
            </div>

            <!-- Circuit Breakers Management Table -->
            <div class="bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow-xl shadow-black/40">
              <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h3 class="text-sm font-bold text-white font-mono flex items-center gap-2">
                    <span>🛡️</span> Circuit Breakers &amp; Fault Tolerance
                  </h3>
                  <p class="text-xs text-slate-400 mt-0.5">Real-time circuit states, failure ratios, and manual trip recovery</p>
                </div>
                <button class="px-3 py-1 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition flex items-center gap-1.5 shadow-sm">
                  <on_click action="REVALIDATE_API" tag="get_telemetry" />
                  <span>↻</span> Refresh Telemetry
                </button>
              </div>

              <div class="overflow-x-auto">
                <table class="w-full text-left text-xs border-collapse font-mono">
                  <thead class="bg-slate-950/60 border-b border-slate-800 text-slate-400 text-[11px]">
                    <tr>
                      <th class="px-6 py-3">Breaker Name</th>
                      <th class="px-6 py-3">State</th>
                      <th class="px-6 py-3">Success / Failure</th>
                      <th class="px-6 py-3">Failure Rate</th>
                      <th class="px-6 py-3">Total Calls</th>
                      <th class="px-6 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-800/60 text-slate-300">
                    <if condition="!data.telemetry.breakers || data.telemetry.breakers.length === 0">
                      <tr>
                        <td class="text-center py-12 text-slate-500 font-sans" colspan="6">
                          No Circuit Breakers registered yet. They will appear here when services or handlers use defineService({ circuitBreaker: true }).
                        </td>
                      </tr>
                    </if>
                    <for_each items="{data.telemetry.breakers}" var="b" key="name">
                      <tr class="hover:bg-slate-850 transition">
                        <td class="px-6 py-3.5 font-bold text-white flex items-center gap-2">
                          <span class="w-2 h-2 rounded-full {b.state == 'OPEN' ? 'bg-rose-500 animate-ping' : (b.state == 'HALF_OPEN' ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500')}"></span>
                          {b.name}
                        </td>
                        <td class="px-6 py-3.5">
                          <span class="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider {b.state == 'OPEN' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : (b.state == 'HALF_OPEN' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30')}">
                            {b.state}
                          </span>
                        </td>
                        <td class="px-6 py-3.5">
                          <span class="text-emerald-400 font-semibold">{b.successes || 0}</span> / <span class="text-rose-400 font-semibold">{b.failures || 0}</span>
                        </td>
                        <td class="px-6 py-3.5">
                          <span class="{b.failureRate > 0.5 ? 'text-rose-400 font-bold' : 'text-slate-400'}">
                            {(b.failureRate * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td class="px-6 py-3.5 text-slate-300">
                          {b.totalCalls || 0}
                        </td>
                        <td class="px-6 py-3.5 text-right">
                          <button class="px-2.5 py-1 text-[11px] font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:text-white transition">
                            <on_click action="XHR" revalidate="get_telemetry">
                              <url>/_studio/api/breakers/{b.name}/reset</url>
                              <method>POST</method>
                            </on_click>
                            Reset
                          </button>
                        </td>
                      </tr>
                    </for_each>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </if>
      </main>
    </div>

    <!-- Declarative Modal Dialog -->
    <if condition="data.isModalOpen">
      <div class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden shadow-2xl shadow-black/80">
          <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h3 class="text-sm font-bold font-mono text-white">
              Add Record to {data.activeTable}
            </h3>
            <button class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition">
              <on_click action="SET_STATE">
                <path>data.isModalOpen</path>
                <value>false</value>
              </on_click>
              ✕
            </button>
          </div>

          <div class="p-6 overflow-y-auto space-y-4">
            <div>
              <span class="block text-xs font-mono font-medium text-slate-300 mb-2">Available Columns:</span>
              <div class="flex flex-wrap gap-1.5">
                <for_each items="{data.columns}" var="field" key="name">
                  <span class="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-950 border border-slate-800 text-slate-300">
                    {field.name} <span class="text-slate-500">({field.type})</span>
                    <if condition="field.isPrimaryKey">
                      <span class="text-amber-400 ml-0.5">🔑</span>
                    </if>
                  </span>
                </for_each>
              </div>
            </div>

            <div>
              <label class="block text-xs font-mono font-medium text-slate-300 mb-1.5">
                Record JSON Payload:
              </label>
              <textarea bind="newRowJson" rows="8" placeholder="{\n  &quot;column_name&quot;: &quot;value&quot;\n}"
                class="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition resize-y"></textarea>
              <p class="text-[11px] text-slate-500 mt-1.5 font-mono">
                Provide field values in JSON. Primary keys can be omitted for auto-increment columns.
              </p>
            </div>
          </div>

          <div class="px-6 py-4 border-t border-slate-800 flex justify-end gap-2.5 bg-slate-900/50">
            <button class="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition">
              <on_click action="SET_STATE">
                <path>data.isModalOpen</path>
                <value>false</value>
              </on_click>
              Cancel
            </button>
            <button class="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-sm shadow-indigo-600/30">
              <on_click action="XHR" revalidate="get_rows">
                <url>/_studio/api/tables/{data.activeTable}/rows</url>
                <method>POST</method>
                <body>{data.newRowJson}</body>
              </on_click>
              <on_click action="REVALIDATE_API" tag="get_tables" />
              <on_click action="SET_STATE">
                <path>data.isModalOpen</path>
                <value>false</value>
              </on_click>
              Save Record
            </button>
          </div>
        </div>
      </div>
    </if>
  </uid_spec>
  </script>

  <!-- Live SSE Telemetry Stream Bridge -->
  <script>
    if (typeof EventSource !== 'undefined') {
      try {
        var es = new EventSource('/_studio/api/live');
        es.onmessage = function (ev) {
          try {
            var data = JSON.parse(ev.data);
            if (window.EUIX && window.EUIX.setState) {
              window.EUIX.setState('telemetry', data);
            }
          } catch (_) {}
        };
      } catch (_) {}
    }
  </script>
</body>
</html>`;
}

module.exports = {
  renderStudioHtml,
};
