/**
 * The MCP tool registry: what an agent can do to an outline. Each tool is an
 * Effect Schema input (the validator IS the published contract — the schema in
 * `tools/list` is derived from the same value that gates `tools/call`, ADR
 * 0014's one-source rule) plus an Effect handler over an `OutlineStore` (the
 * caller's per-user DO stub in production, an in-memory fake in tests).
 *
 * Agent-native posture: whatever a human can do in the editor, within reason —
 * read/search the outline, add/edit/delete nodes, put things on today's daily
 * note, mirror nodes. Every write is planned purely (worker/outline-ops.ts)
 * and committed through the DO's `applyBatch` as ONE atomic frame (ADR 0009),
 * so a connected editor sees an agent's edit live over the same sync socket a
 * second device would. The core protection rule holds here too: the daily
 * container can't be deleted, blanked, made a task, or completed (ADR 0015).
 */

import { Data, Effect, Schema } from "effect";

import type { ChangeOp, Node } from "../src/data/wire-schema";
import type { KvClaim } from "./outline-do";

import {
  DEFAULT_WEEK_START,
  PROTECTED_SCAFFOLD_KINDS,
  dayKeyToScaffoldChain,
  scaffoldKeyKind,
  scaffoldLabel,
  type WeekStart,
} from "../src/data/date-links";
import {
  AGENT_FOLDER_TITLE,
  agentFolderPlan,
  buildLibraryTree,
  type LibraryItem,
  type LibraryRow,
  LibraryRowSchema,
  rankBetween,
  rankForDrop,
  rowsInFolder,
  unfiledNodeIds,
} from "../src/data/library-core";
import { exportOpml } from "../src/data/opml-export";
import {
  OPML_MCP_MAX_NODES,
  type OpmlImportReport,
  parseOpml,
  planOpmlImport,
} from "../src/data/opml-import";
import { redactSpoilers } from "../src/data/spoiler";
import { childrenOf, createId } from "../src/data/tree";
import {
  type NodeFieldChanges,
  DAILY_CONTAINER_TEXT,
  type DailyScaffold,
  type TreeIndex,
  buildTreeIndex,
  flattenSubtree,
  formatDayText,
  isValidDateKey,
  formatOutlineLines,
  guardForestSize,
  type SubtreeInput,
  planAddNode,
  planAddSubtree,
  planAddSubtreeToDaily,
  planAddToDaily,
  planDeleteNode,
  planEnsureDaily,
  planMirrorNode,
  planMirrorToDaily,
  planReparent,
  planUpdateNode,
  redactSpoilerIndex,
  trueSourceOf,
} from "./outline-ops";
import { SearchInput, SearchPage, searchPage } from "./search";

// Re-exported so worker/index.ts can hand the DO stub over without importing
// the planner module directly.
export type { ChangeOp, Node };

/**
 * The slice of the per-user DO a tool needs. `DurableObjectStub<UserOutlineDO>`
 * satisfies it structurally (stub RPC methods return Promises; the sync returns
 * cover an in-process fake in tests).
 */
export interface OutlineStore {
  getNodes(): Node[] | Promise<Node[]>;
  applyBatch(
    ops: readonly ChangeOp[],
    expectedWeekStart?: WeekStart,
  ): number | Promise<number>;
  getKv(collection: string): unknown[] | Promise<unknown[]>;
  /** Atomic get-or-create on one kv key: the stored value wins. The DO stores
   *  any JSON row; callers decode what comes back. */
  getOrCreateKv(
    collection: string,
    key: string,
    value: KvClaim | LibraryRow,
  ): KvClaim | LibraryRow | Promise<KvClaim | LibraryRow>;
  /** Insert or replace kv rows (the library tools write folders and notes). */
  upsertKv(
    collection: string,
    rows: readonly { key: string; value: unknown }[],
  ): void | Promise<void>;
  migrateWeekStart?(
    weekStart: WeekStart,
    limit: number | null,
  ):
    | { weekStart: WeekStart; seq: number }
    | { error: "node_limit" | "locked" }
    | Promise<
        | { weekStart: WeekStart; seq: number }
        | { error: "node_limit" | "locked" }
      >;
  canonicalizeWeekStart?(
    limit: number | null,
  ):
    | { weekStart: WeekStart; seq: number }
    | { error: "node_limit" | "locked" }
    | Promise<
        | { weekStart: WeekStart; seq: number }
        | { error: "node_limit" | "locked" }
      >;
}

/** A tool execution failure — surfaces as an `isError` tool result (the MCP
 *  shape for "the tool ran and refused"), never a protocol-level error. */
export class ToolError extends Data.TaggedError("ToolError")<{
  reason: string;
}> {
  get message() {
    return this.reason;
  }
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: SearchPage;
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  /** Input contract; also the source of the published JSON Schema. Typed as
   *  the decode-ready schema seam (never services) so consumers of the
   *  registry don't inherit `any` from an erased `Schema.Struct<any>`. */
  input: Schema.Top & { readonly DecodingServices: never };
  /** Published contract for tools that return structuredContent. */
  output?: Schema.Top & { readonly DecodingServices: never };
  /** MCP `readOnlyHint` — true for tools that never write. */
  readOnly: boolean;
  /** `origin` is the caller's provenance stamp — the OAuth client's harness name
   *  (worker/index.ts resolves it from the bearer token), written onto every node
   *  a write tool creates so the editor can tell agent edits from the user's own.
   *  Read-only tools ignore it. */
  handle: (
    input: any,
    store: OutlineStore,
    origin: string | null,
  ) => Effect.Effect<string | ToolResult, ToolError>;
}

// --- Shared plumbing ----------------------------------------------------------

/** Store failures carry real diagnostics (e.g. the Lunora shard's SQLite
 *  message). `Effect.promise` would turn them into defects, which the MCP
 *  endpoint reports as a bare "internal error" — so every store call goes
 *  through `tryPromise` with a catch that lifts the failure's message into
 *  the typed ToolError channel. */
const toolErrorFrom = (error: Error): ToolError =>
  new ToolError({ reason: error.message });

const loadIndex = (store: OutlineStore): Effect.Effect<TreeIndex, ToolError> =>
  Effect.tryPromise({
    try: async () => buildTreeIndex(await store.getNodes()),
    // SAFETY: Effect's catch hands us the untyped rejection; Error messages carry the real diagnostics (e.g. the shard's SQLite error), anything else stringifies.
    catch: (error) =>
      error instanceof Error
        ? toolErrorFrom(error)
        : new ToolError({ reason: String(error) }),
  });

const commit = (
  store: OutlineStore,
  ops: ReadonlyArray<ChangeOp>,
  expectedWeekStart?: WeekStart,
): Effect.Effect<void, ToolError> =>
  Effect.tryPromise({
    try: async () => {
      if (ops.length) await store.applyBatch(ops, expectedWeekStart);
    },
    // SAFETY: Effect's catch hands us the untyped rejection; Error messages carry the real diagnostics (e.g. the shard's SQLite error), anything else stringifies.
    catch: (error) =>
      error instanceof Error
        ? toolErrorFrom(error)
        : new ToolError({ reason: String(error) }),
  });

/** Lift a planner's value-shaped failure into the tool error channel,
 *  narrowing the success side (the planners' errors all extend `Error`). */
const unwrap = <A>(result: A): Effect.Effect<Exclude<A, Error>, ToolError> =>
  result instanceof Error
    ? Effect.fail(new ToolError({ reason: result.message }))
    : // SAFETY: the instanceof Error branch above removed the Error side of A.
      Effect.succeed(result as Exclude<A, Error>);

/** The write-timestamp source. Mutable so tests can pin "now" (the pre-agreed
 *  seam for deterministic timezone/day-boundary tests); production reads the
 *  real clock on every call, exactly as before. */
let clock: Effect.Effect<number, never> = Effect.sync(() => Date.now());

/** Test seam: pin the clock to a fixed instant (or restore with `null`). The
 *  daily tools resolve "today" from this, so timezone-boundary cases are
 *  deterministic. */
export const setClock = (now: number | null): void => {
  clock = now == null ? Effect.sync(() => Date.now()) : Effect.succeed(now);
};

// --- Daily-index claims -------------------------------------------------------

const KV_DAILY = "daily-index";
const CONTAINER_KEY = "container";

const DailyRowSchema = Schema.Struct({
  key: Schema.String,
  nodeId: Schema.String,
});

/** Atomically claim `key -> candidate` in the daily index and return the
 *  authoritative winner — the DO-side twin of the client's `claimMapping`. */
const claimDailyId = (
  store: OutlineStore,
  key: string,
  candidate: string,
): Effect.Effect<string, ToolError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () =>
        Promise.resolve(
          store.getOrCreateKv(KV_DAILY, key, { key, nodeId: candidate }),
        ),
      // SAFETY: Effect's catch hands us the untyped rejection; Error messages carry the real diagnostics (e.g. the shard's SQLite error), anything else stringifies.
      catch: (error) =>
        error instanceof Error
          ? toolErrorFrom(error)
          : new ToolError({ reason: String(error) }),
    });
    const row = yield* Schema.decodeUnknownEffect(DailyRowSchema)(raw).pipe(
      Effect.mapError(
        () =>
          new ToolError({
            reason: `daily index row for "${key}" is malformed`,
          }),
      ),
    );
    return row.nodeId;
  });

/** The daily-index reverse map (nodeId -> scaffold key) — powers both the
 *  chronological-ascending sibling insertion in `planEnsureDaily` and the
 *  server-side protection guards (which resolve a node id to its scaffold kind).
 *  A read, no side effects. */
const loadDailyReverseMap = (
  store: OutlineStore,
): Effect.Effect<ReadonlyMap<string, string>, ToolError> =>
  Effect.gen(function* () {
    const rows = yield* Effect.tryPromise({
      try: () => Promise.resolve(store.getKv(KV_DAILY)),
      // SAFETY: Effect's catch hands us the untyped rejection; Error messages carry the real diagnostics (e.g. the shard's SQLite error), anything else stringifies.
      catch: (error) =>
        error instanceof Error
          ? toolErrorFrom(error)
          : new ToolError({ reason: String(error) }),
    });
    const map = new Map<string, string>();
    for (const raw of rows) {
      const row = Schema.decodeUnknownOption(DailyRowSchema)(raw);
      if (row._tag === "Some") map.set(row.value.nodeId, row.value.key);
    }
    return map;
  });

const loadWeekStart = (
  store: OutlineStore,
): Effect.Effect<WeekStart, ToolError> =>
  Effect.gen(function* () {
    const rows = yield* Effect.tryPromise({
      try: () => Promise.resolve(store.getKv("account-prefs")),
      catch: (error) =>
        error instanceof Error
          ? toolErrorFrom(error)
          : new ToolError({ reason: String(error) }),
    });
    const schema = Schema.Struct({
      key: Schema.Literal("daily:week-start"),
      weekStart: Schema.Literals(["sunday", "monday"]),
    });
    for (const raw of rows) {
      const decoded = Schema.decodeUnknownOption(schema)(raw);
      if (decoded._tag === "Some") return decoded.value.weekStart;
    }
    return DEFAULT_WEEK_START;
  });

/** The claimed ids of the whole `Daily > YYYY > Month > Week > Day` chain plus
 *  the reverse map — the DO-side twin of the client's ensure cascade (issue
 *  #271). Each level is claimed atomically PER LEVEL through `getOrCreateKv`, so
 *  two concurrent agents converge on ONE node per level; `planEnsureDaily` then
 *  materializes whichever rows are missing and sorts them into place. */
const claimDailyScaffold = (
  store: OutlineStore,
  dateKey: string,
): Effect.Effect<DailyScaffold & { index: TreeIndex }, ToolError> =>
  Effect.gen(function* () {
    if (store.canonicalizeWeekStart) {
      const migrated = yield* Effect.tryPromise({
        try: () => Promise.resolve(store.canonicalizeWeekStart!(null)),
        catch: (error) =>
          error instanceof Error
            ? toolErrorFrom(error)
            : new ToolError({ reason: String(error) }),
      });
      if ("error" in migrated) {
        return yield* Effect.fail(
          new ToolError({
            reason:
              migrated.error === "locked"
                ? "calendar migration is blocked by a locked node"
                : "calendar migration exceeds the node limit",
          }),
        );
      }
    }
    const weekStart = yield* loadWeekStart(store);
    const chain = dayKeyToScaffoldChain(dateKey, weekStart);
    if (!chain) {
      return yield* Effect.fail(
        new ToolError({
          reason: `invalid date "${dateKey}" — can't place it on the calendar`,
        }),
      );
    }
    // Container + day claims and the reverse-map fetch are independent, so run
    // them CONCURRENTLY (finding 6/8b: was 6 sequential RPCs). Each claim is a
    // per-key atomic `getOrCreateKv` on a FRESH candidate id, and nothing reads
    // another claim's result, so the batch is race-safe.
    const [containerId, dayId, keyByNodeId] = yield* Effect.all(
      [
        claimDailyId(store, CONTAINER_KEY, createId()),
        claimDailyId(store, dateKey, createId()),
        loadDailyReverseMap(store),
      ],
      { concurrency: "unbounded" },
    );

    // The Y/M/W scaffold is claimed ONLY when the day node is absent (finding 6,
    // mirroring `planEnsureDaily`'s early-return): an existing (pre-migration
    // flat) day is reused verbatim and never gets a parallel scaffold, so no
    // dangling kv mappings. One index read decides -- and it's RETURNED so the
    // caller reuses it (finding 6): nothing between here and the caller's plan
    // mutates nodes (only kv claims), so a second `loadIndex` would rebuild the
    // identical tree.
    const index = yield* loadIndex(store);
    if (index.byId.has(dayId))
      return { containerId, dayId, keyByNodeId, weekStart, index };

    const [yearId, monthId, weekId] = yield* Effect.all(
      [
        claimDailyId(store, chain.yearKey, createId()),
        claimDailyId(store, chain.monthKey, createId()),
        claimDailyId(store, chain.weekKey, createId()),
      ],
      { concurrency: "unbounded" },
    );
    return {
      containerId,
      yearId,
      monthId,
      weekId,
      dayId,
      keyByNodeId,
      weekStart,
      index,
    };
  });

/** The calendar day a given instant falls on in a given IANA timezone — the
 *  server-side twin of the client's `localDateKey`, for an arbitrary zone
 *  instead of the browser's own. Uses the formatter rather than offset math so
 *  DST and historical zone changes are the engine's problem, not ours. */
const todayInZone = (now: number, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};

/** Resolve the tool's optional `date` input to a valid `YYYY-MM-DD` key. An
 *  explicit `date` wins outright. Otherwise "today" is the caller's local day
 *  when a `timeZone` is given (matching `localDateKey` in the app), else UTC
 *  today — tools advertise that callers should pass the user's local date, since
 *  the Worker can't otherwise know their timezone. */
const resolveDateKey = (
  date: string | null | undefined,
  timeZone: string | null | undefined,
  now: number,
): Effect.Effect<string, ToolError> => {
  // Validate the timezone even when `date` wins: a typo'd zone is a caller bug
  // worth surfacing, and it keeps `tools/list`'s promise that a bad value is
  // refused rather than silently ignored.
  if (timeZone != null) {
    try {
      // Throws RangeError for anything that isn't a real IANA zone name.
      new Intl.DateTimeFormat("en", { timeZone });
    } catch {
      return Effect.fail(
        new ToolError({
          reason: `invalid timeZone "${timeZone}" — expected a real IANA name (e.g. America/New_York)`,
        }),
      );
    }
  }
  if (date != null) {
    return isValidDateKey(date)
      ? Effect.succeed(date)
      : Effect.fail(
          new ToolError({
            reason: `invalid date "${date}" — expected a real YYYY-MM-DD`,
          }),
        );
  }
  const key =
    timeZone != null
      ? todayInZone(now, timeZone)
      : new Date(now).toISOString().slice(0, 10);
  return Effect.succeed(key);
};

// --- Protection (ADR 0015, server-enforced) -----------------------------------
// The daily container AND every intermediate calendar scaffold node (year,
// month, week) are protected: no delete / blank / to-do / complete (issue #271
// decision 6). Deleting any of them cascades — an unprotected week delete would
// take its days with it. Days themselves are content, so they stay editable and
// deletable. A node's protection is resolved from the daily-index reverse map:
// its key's `scaffoldKeyKind` tells container/year/month/week apart from day.

/** The human label for a PROTECTED scaffold node (container/year/month/week), or
 *  null when the key is a day or unknown (not protected). */
const protectedScaffoldLabel = (key: string): string | null => {
  const kind = scaffoldKeyKind(key);
  // Which kinds are protected is the shared source of truth (finding 10b), so
  // the client and Worker can't drift on it. The label derives from the shared
  // `scaffoldLabel` (10c); the phrasing stays Worker-local.
  if (!kind || !PROTECTED_SCAFFOLD_KINDS.has(kind)) return null;
  switch (kind) {
    case "container":
      return `the "${DAILY_CONTAINER_TEXT}" container`;
    case "year":
      return `the "${scaffoldLabel(key)}" calendar year`;
    case "month":
      return `the "${scaffoldLabel(key)}" calendar month`;
    case "week":
      return `the "${scaffoldLabel(key)}" calendar week`;
    default:
      return null; // day (content) or unknown
  }
};

const guardScaffoldDelete = (
  keyByNodeId: ReadonlyMap<string, string>,
  deletedIds: ReadonlyArray<string>,
): Effect.Effect<void, ToolError> => {
  for (const id of deletedIds) {
    const key = keyByNodeId.get(id);
    const label = key ? protectedScaffoldLabel(key) : null;
    if (label)
      return Effect.fail(
        new ToolError({
          reason: `${label} is protected and can't be deleted (it holds your daily notes)`,
        }),
      );
  }
  return Effect.void;
};

const guardScaffoldUpdate = (
  index: TreeIndex,
  keyByNodeId: ReadonlyMap<string, string>,
  nodeId: string,
  changes: { text?: string; isTask?: boolean; completed?: boolean },
): Effect.Effect<void, ToolError> => {
  if (!index.byId.has(nodeId)) return Effect.void;
  // A content edit follows the mirror's true source; check both the raw id and
  // its source so a mirror of a scaffold node is guarded too.
  const key =
    keyByNodeId.get(trueSourceOf(index, nodeId)) ?? keyByNodeId.get(nodeId);
  const label = key ? protectedScaffoldLabel(key) : null;
  if (!label) return Effect.void;
  const violation =
    changes.text !== undefined && !changes.text.trim()
      ? "blanked (it's how your daily notes are found)"
      : changes.isTask
        ? "made a to-do"
        : changes.completed
          ? "completed"
          : null;
  return violation
    ? Effect.fail(
        new ToolError({
          reason: `${label} is protected and can't be ${violation}`,
        }),
      )
    : Effect.void;
};

// --- Input schemas ------------------------------------------------------------
// `Schema.optional(Schema.NullOr(...))` throughout: the published JSON Schema
// advertises `T | null`, and the decoder accepts BOTH an omitted key and an
// explicit null — agents routinely send either.

const optional = <S extends Schema.Top>(schema: S) =>
  Schema.optional(Schema.NullOr(schema));

/** Node kind (ADR 0045). The only value is `"paragraph"`; omit it (or pass null)
 *  for a plain bullet or, with `isTask`, a to-do. `kind` overrides `isTask`. */
const kindField = optional(
  Schema.Literal("paragraph").annotate({
    description:
      "Create as a paragraph (prose, drawn with a paragraph glyph instead of a bullet) rather than a list item. Mutually exclusive with isTask, which it overrides.",
  }),
);

const dateField = optional(
  Schema.String.annotate({
    description:
      "The day's date as YYYY-MM-DD. Pass the user's local date; defaults to today in UTC.",
  }),
);

/** The caller's IANA timezone (e.g. "America/New_York", "Asia/Tokyo"). When the
 *  `date` is omitted, "today" resolves in this timezone instead of UTC — so a
 *  late-evening capture lands on the user's own calendar day. On the tools where
 *  `date` is a required target selector (add_subtree / import_opml), it is
 *  ignored unless `date` is present, and an explicit `date` always wins. */
const timeZoneField = optional(
  Schema.String.annotate({
    description:
      "The caller's IANA timezone (e.g. America/New_York, Asia/Tokyo). When `date` is omitted, today resolves in this timezone instead of UTC; an explicit date always wins.",
  }),
);

const GetOutlineInput = Schema.Struct({
  nodeId: optional(
    Schema.String.annotate({
      description:
        "Root node to read from. Omit to read the whole outline from the top level.",
    }),
  ),
  maxDepth: optional(
    Schema.Int.annotate({
      description: "How many levels deep to read (default: unlimited).",
    }),
  ),
});

const AddNodeInput = Schema.Struct({
  text: Schema.String.annotate({ description: "The bullet text." }),
  parentId: optional(
    Schema.String.annotate({
      description: "Parent node id. Omit to add at the top level.",
    }),
  ),
  position: optional(
    Schema.Literals(["first", "last"]).annotate({
      description: "Insert as the first or last child (default: last).",
    }),
  ),
  isTask: optional(
    Schema.Boolean.annotate({
      description: "Create as a to-do with a checkbox (default: false).",
    }),
  ),
  kind: kindField,
});

/** One node in an `add_subtree` forest — recursive via `Schema.suspend`, which
 *  publishes as a named `$ref`/`$defs` in `tools/list` (ADR 0028). Fresh content
 *  only: text + optional to-do flag + optional nested children. The decoded type
 *  IS the planner's own `SubtreeInput` — one shape, one source. */
const SubtreeNodeInput: Schema.Codec<SubtreeInput> = Schema.Struct({
  text: Schema.String.annotate({ description: "The bullet text." }),
  isTask: optional(
    Schema.Boolean.annotate({
      description: "Create as a to-do with a checkbox (default: false).",
    }),
  ),
  kind: kindField,
  children: optional(
    Schema.Array(
      Schema.suspend((): Schema.Codec<SubtreeInput> => SubtreeNodeInput),
    ).annotate({
      description: "Nested child bullets, each with this same shape.",
    }),
  ),
}).annotate({ identifier: "SubtreeNode" });

const AddSubtreeInput = Schema.Struct({
  nodes: Schema.Array(SubtreeNodeInput).annotate({
    description:
      "The bullets to create, as a nested forest. Each node may carry its own `children`, so a whole outline lands in one call.",
  }),
  parentId: optional(
    Schema.String.annotate({
      description:
        "Parent node id to add under. Omit for the top level. Mutually exclusive with `date`.",
    }),
  ),
  date: optional(
    Schema.String.annotate({
      description:
        "Add onto the daily note for this YYYY-MM-DD instead of a parent (pass the user's local date). Mutually exclusive with `parentId`.",
    }),
  ),
  timeZone: optional(
    Schema.String.annotate({
      description:
        "The caller's IANA timezone (e.g. America/New_York). Refines an omitted `date` on the daily path; ignored at the top level (no `date`), and an explicit `date` wins.",
    }),
  ),
  position: optional(
    Schema.Literals(["first", "last"]).annotate({
      description:
        "Insert the forest as the first or last children of the parent (default: last). Ignored for the `date` path, which always appends.",
    }),
  ),
});

const UpdateNodeInput = Schema.Struct({
  nodeId: Schema.String.annotate({ description: "The node to update." }),
  text: optional(Schema.String.annotate({ description: "New bullet text." })),
  isTask: optional(
    Schema.Boolean.annotate({
      description:
        "Turn the checkbox on (true) or off (false). Either value also turns a paragraph back into a list item — a node is exactly one of bullet, to-do, or paragraph.",
    }),
  ),
  completed: optional(
    Schema.Boolean.annotate({
      description: "Mark done (true) or not done (false).",
    }),
  ),
  collapsed: optional(
    Schema.Boolean.annotate({
      description: "Collapse (true) or expand (false) the bullet.",
    }),
  ),
  // Two explicit words rather than `"paragraph" | null`: an omitted key and an
  // explicit null both decode to "no change" everywhere else in this schema set,
  // so null cannot also mean "make it a bullet". `"bullet"` says it out loud.
  kind: optional(
    Schema.Literals(["paragraph", "bullet"]).annotate({
      description:
        'Turn the node into a paragraph ("paragraph") or back into a plain list item ("bullet"). Overrides isTask in the same call.',
    }),
  ),
});

const DeleteNodeInput = Schema.Struct({
  nodeId: Schema.String.annotate({
    description: "The node to delete. Its whole subtree is deleted with it.",
  }),
});

const MoveNodesInput = Schema.Struct({
  nodeIds: Schema.Array(Schema.String).annotate({
    description:
      "The nodes to move. Each moves with its whole subtree; the order you pass is kept.",
  }),
  newParentId: optional(
    Schema.String.annotate({
      description: "Where to move them. Omit or null for the top level.",
    }),
  ),
  position: optional(
    Schema.Literals(["first", "last"]).annotate({
      description:
        "Land as the first or last children of the parent (default: last).",
    }),
  ),
});

const AddToTodayInput = Schema.Struct({
  text: Schema.String.annotate({
    description: "The bullet text to add to the daily note.",
  }),
  isTask: optional(
    Schema.Boolean.annotate({
      description: "Create as a to-do with a checkbox (default: false).",
    }),
  ),
  kind: kindField,
  date: dateField,
  timeZone: timeZoneField,
});

const MirrorNodeInput = Schema.Struct({
  nodeId: Schema.String.annotate({
    description: "The node to mirror (its subtree comes with it).",
  }),
  parentId: optional(
    Schema.String.annotate({
      description: "Where to put the mirror. Omit to mirror to the top level.",
    }),
  ),
});

const MirrorToTodayInput = Schema.Struct({
  nodeId: Schema.String.annotate({
    description: "The node to mirror onto the daily note.",
  }),
  date: dateField,
  timeZone: timeZoneField,
});

// The OPML pair (ADR 0037). The document travels as a plain string — a
// non-recursive input, so no `identifier` annotation is needed (unlike
// add_subtree's forest). Deliberately NO url-fetch argument: fetching a
// caller-supplied URL from the Worker is an authenticated SSRF surface
// re-treading unfurl.ts for territory the string argument already covers.

const ImportOpmlInput = Schema.Struct({
  opml: Schema.String.annotate({
    description:
      "The OPML document to import, as an XML string (e.g. a Workflowy export).",
  }),
  parentId: optional(
    Schema.String.annotate({
      description:
        "Parent node id to import under. Omit for the top level. Mutually exclusive with `date`.",
    }),
  ),
  date: optional(
    Schema.String.annotate({
      description:
        "Import onto the daily note for this YYYY-MM-DD instead of a parent (pass the user's local date). Mutually exclusive with `parentId`.",
    }),
  ),
  timeZone: optional(
    Schema.String.annotate({
      description:
        "The caller's IANA timezone (e.g. America/New_York). Refines an omitted `date` on the daily path; ignored at the top level (no `date`), and an explicit `date` wins.",
    }),
  ),
  dryRun: optional(
    Schema.Boolean.annotate({
      description:
        "Parse and plan without writing anything; returns the same receipt (default: false).",
    }),
  ),
});

const ExportOpmlInput = Schema.Struct({
  nodeId: optional(
    Schema.String.annotate({
      description:
        "Root node to export (the node and its whole subtree). Omit to export the whole outline.",
    }),
  ),
});

// --- The tools ----------------------------------------------------------------

const ListLibraryInput = Schema.Struct({});

const CreateFolderInput = Schema.Struct({
  title: Schema.String.annotate({ description: "The folder's name." }),
  parentFolderId: optional(
    Schema.String.annotate({
      description:
        "Folder to create it inside (an id from list_library). Omit for the top of the library.",
    }),
  ),
});

const CreateNoteInput = Schema.Struct({
  title: Schema.String.annotate({
    description: "The note's title: the text of its top-level bullet.",
  }),
  folderId: optional(
    Schema.String.annotate({
      description:
        'Folder to file the note in (an id from list_library). Omit to file it in the "Agent" folder, which is created if missing.',
    }),
  ),
  children: optional(
    Schema.Array(SubtreeNodeInput).annotate({
      description:
        "The note's initial content: a nested forest of bullets under the title, the same shape as add_subtree's `nodes`.",
    }),
  ),
});

const MoveNoteInput = Schema.Struct({
  nodeId: Schema.String.annotate({
    description:
      "The note's top-level node id (from list_library or get_outline). An unfiled top-level node is filed as a new note.",
  }),
  folderId: optional(
    Schema.String.annotate({
      description:
        "Destination folder id. Omit or null for the top of the library.",
    }),
  ),
  position: optional(
    Schema.Literals(["first", "last"]).annotate({
      description: "First or last in the folder (default: last).",
    }),
  ),
});

const MAX_OUTLINE_NODES = 500;
/** One `add_subtree` batch = one DO `transactionSync` = one sync frame; cap the
 *  forest at the same ceiling an agent hits reading back (ADR 0028). */
const MAX_BATCH_NODES = 500;

/** Finalize agent-facing write receipts at the shared MCP boundary. Keep the
 * planner inputs and committed node text verbatim; only text returned to the
 * agent is redacted (ADR 0043). */
const mcpReceipt = (text: string): string => redactSpoilers(text);

/** Render a freshly-planned forest as the agent-facing bullet list with ids —
 *  built from the plan's own insert ops, so no extra read of the store. */
const renderCreatedForest = (
  ops: ReadonlyArray<ChangeOp>,
  rootIds: ReadonlyArray<string>,
): string => {
  const created = buildTreeIndex(
    ops.flatMap((o) => (o.op === "insert" ? [o.value] : [])),
  );
  const lines = rootIds.flatMap((id) => {
    const r = flattenSubtree(created, id, {
      maxDepth: Number.POSITIVE_INFINITY,
      maxNodes: MAX_BATCH_NODES,
    });
    return r instanceof Error ? [] : r.lines;
  });
  return formatOutlineLines(lines);
};

// --- OPML receipt (ADR 0037) ----------------------------------------------------
// import_opml never echoes the forest back (the caller already holds the
// document); it answers with a COMPACT receipt — root ids + texts, counts, and
// the degradation tally with zero-count lines omitted. This is the only place
// MCP disclosure can live, so the "degraded, never silent" bar lands here.

/** Cap the receipt's root listing — a wide document can carry thousands of
 *  top-level outlines, and the receipt must stay compact. */
const MAX_RECEIPT_ROOTS = 20;

const tallyLines = (record: Record<string, number>): string[] =>
  Object.entries(record).map(([msg, n]) => `- ${msg}: ${n}`);

const renderImportReceipt = (args: {
  report: OpmlImportReport;
  rootIds: ReadonlyArray<string>;
  rootTexts: ReadonlyArray<string>;
  landing: string;
  dryRun: boolean;
}): string => {
  const { report } = args;
  const lines: string[] = [
    args.dryRun
      ? `Dry run — would import ${report.nodesPost} node(s) ${args.landing}. Nothing was written.`
      : `Imported ${report.nodesPost} node(s) ${args.landing}.`,
    `Root bullet(s) (${args.rootIds.length}):`,
  ];
  const shown = args.rootIds.slice(0, MAX_RECEIPT_ROOTS);
  shown.forEach((id, i) => {
    lines.push(`- "${args.rootTexts[i] || "(empty)"}" (id: ${id})`);
  });
  if (args.rootIds.length > shown.length) {
    lines.push(`- … and ${args.rootIds.length - shown.length} more`);
  }
  const counts: string[] = [];
  if (report.nodesPost !== report.nodesPre) {
    counts.push(
      `${report.nodesPre} OPML outline(s) became ${report.nodesPost} bullet(s) after note/newline splitting`,
    );
  }
  if (report.notes)
    counts.push(
      `${report.notes} _note attribute(s) -> ${report.noteLines} child bullet(s)`,
    );
  if (report.textNewlineSplits)
    counts.push(
      `${report.textNewlineSplits} bullet(s) split on embedded newlines`,
    );
  if (report.emptyText) counts.push(`${report.emptyText} empty-text bullet(s)`);
  if (report.mirrorsLinked)
    counts.push(`${report.mirrorsLinked} mirror(s) re-linked`);
  if (report.mirrorsDetached)
    counts.push(
      `${report.mirrorsDetached} mirror(s) imported as detached copies`,
    );
  if (counts.length) {
    lines.push("Counts:");
    for (const c of counts) lines.push(`- ${c}`);
  }
  if (report.degradedTotal === 0) {
    lines.push("No fidelity degradations.");
  } else {
    lines.push(`Fidelity degradations (${report.degradedTotal}):`);
    lines.push(...tallyLines(report.degraded));
  }
  if (Object.keys(report.anomalies).length) {
    lines.push("Tolerated HTML anomalies:");
    lines.push(...tallyLines(report.anomalies));
  }
  if (Object.keys(report.unknownAttributes).length) {
    lines.push("Unknown OPML attributes (ignored):");
    lines.push(...tallyLines(report.unknownAttributes));
  }
  return lines.join("\n");
};

// --- Library (docs/workbench/PLAN.md 1.10, 2.9) ---------------------------------
// The sidebar's folders and notes are the `library` kv side-collection; a note
// is a top-level node the library files under a folder. kv writes don't push
// over the sync socket, so an open editor picks them up on its next refetch
// (window focus); the nodes themselves arrive live as usual.

const KV_LIBRARY = "library";
/** Cap on the unfiled listing, so a big legacy outline stays a compact read. */
const MAX_UNFILED_LISTED = 100;

/** Run a kv store call through the typed error channel. */
const kvCall = <A>(run: () => A | Promise<A>): Effect.Effect<A, ToolError> =>
  Effect.tryPromise({
    try: async () => run(),
    // SAFETY: Effect's catch hands us the untyped rejection; Error messages carry the real diagnostics (e.g. the shard's SQLite error), anything else stringifies.
    catch: (error) =>
      error instanceof Error
        ? toolErrorFrom(error)
        : new ToolError({ reason: String(error) }),
  });

/** The library as stored: its well-formed rows (a malformed one, an older or
 *  foreign write, is skipped, as the client collection's schema would reject
 *  it), each row's full stored record (a write keeps fields this version
 *  doesn't know), and every stored id, malformed rows included. */
const StoredRecord = Schema.Record(Schema.String, Schema.Json);
type StoredRecord = typeof StoredRecord.Type;

interface StoredLibrary {
  rows: LibraryRow[];
  records: ReadonlyMap<string, StoredRecord>;
  ids: ReadonlySet<string>;
}

const loadLibrary = (
  store: OutlineStore,
): Effect.Effect<StoredLibrary, ToolError> =>
  Effect.map(
    kvCall(() => store.getKv(KV_LIBRARY)),
    (raw) => {
      const rows: LibraryRow[] = [];
      const records = new Map<string, StoredRecord>();
      const ids = new Set<string>();
      for (const value of raw) {
        const record = Schema.decodeUnknownOption(StoredRecord)(value);
        const row = Schema.decodeUnknownOption(LibraryRowSchema)(value);
        if (record._tag === "Some" && Object.hasOwn(record.value, "id"))
          ids.add(String(record.value["id"]));
        if (row._tag === "None" || record._tag === "None") continue;
        rows.push(row.value);
        records.set(row.value.id, record.value);
      }
      return { rows, records, ids };
    },
  );

const saveLibrary = (
  store: OutlineStore,
  rows: readonly LibraryRow[],
  records: StoredLibrary["records"] = new Map(),
): Effect.Effect<void, ToolError> =>
  kvCall(() =>
    store.upsertKv(
      KV_LIBRARY,
      rows.map((row) => ({
        key: row.id,
        value: { ...records.get(row.id), ...row },
      })),
    ),
  );

const libraryId = (prefix: "f" | "n"): string => `${prefix}_${createId()}`;

/** A top-level node's title as an agent reads it. */
const noteTitle = (index: TreeIndex, nodeId: string): string =>
  redactSpoilers(index.byId.get(nodeId)?.text.trim() || "Untitled");

/** The Agent folder's id, creating it if needed -- through the DO's atomic
 *  get-or-create, so two agent calls racing to create it make one folder and
 *  neither overwrites a folder that appeared (or was renamed) meanwhile. */
const claimAgentFolder = (
  store: OutlineStore,
  library: StoredLibrary,
): Effect.Effect<{ id: string; title: string | undefined }, ToolError> =>
  Effect.gen(function* () {
    const plan = agentFolderPlan(library.rows, library.ids);
    if (!plan.create) return { id: plan.id, title: AGENT_FOLDER_TITLE };
    const folder: LibraryRow = {
      id: plan.id,
      type: "folder",
      parentId: null,
      rank: rankForDrop(rowsInFolder(library.rows, null), null),
      title: AGENT_FOLDER_TITLE,
    };
    const stored = yield* kvCall(() =>
      store.getOrCreateKv(KV_LIBRARY, plan.id, folder),
    );
    const row = Schema.decodeUnknownOption(LibraryRowSchema)(stored);
    if (row._tag === "None" || row.value.type !== "folder")
      return yield* Effect.fail(
        new ToolError({ reason: `library row "${plan.id}" is not a folder` }),
      );
    return { id: row.value.id, title: row.value.title };
  });

/** A folder id the caller passed must name a folder. */
const requireFolder = (
  rows: readonly LibraryRow[],
  folderId: string,
): Effect.Effect<LibraryRow, ToolError> => {
  const row = rows.find((r) => r.id === folderId);
  return row?.type === "folder"
    ? Effect.succeed(row)
    : Effect.fail(
        new ToolError({
          reason: `no folder with id "${folderId}" — list_library shows the folder ids`,
        }),
      );
};

/** The library tree as indented lines with ids. */
const renderLibrary = (
  items: readonly LibraryItem[],
  index: TreeIndex,
  depth = 0,
): string[] =>
  items.flatMap((item) => {
    const pad = "  ".repeat(depth);
    if (item.kind === "note")
      return [
        `${pad}- ${noteTitle(index, item.rootNodeId)} (note; node id: ${item.rootNodeId})`,
      ];
    return [
      `${pad}- [folder] ${redactSpoilers(item.row.title?.trim() || "Untitled folder")} (folder id: ${item.row.id})`,
      ...renderLibrary(item.children, index, depth + 1),
    ];
  });

export const tools: ReadonlyArray<ToolDef> = [
  {
    name: "get_outline",
    description:
      "Read the outline (or one node and its subtree) as an indented bullet list. Every line carries its node id — use those ids with the other tools.",
    input: GetOutlineInput,
    readOnly: true,
    handle: (input: typeof GetOutlineInput.Type, store) =>
      Effect.gen(function* () {
        const index = yield* loadIndex(store);
        const result = yield* unwrap(
          flattenSubtree(index, input.nodeId ?? null, {
            maxDepth: input.maxDepth ?? Number.POSITIVE_INFINITY,
            maxNodes: MAX_OUTLINE_NODES,
          }),
        );
        if (!result.lines.length) return "The outline is empty.";
        const body = formatOutlineLines(result.lines);
        return result.truncated
          ? `${body}\n\n(truncated at ${MAX_OUTLINE_NODES} nodes — read a subtree via nodeId for more)`
          : body;
      }),
  },
  {
    name: "search_nodes",
    description:
      "Find nodes with DQL, the same grammar as the app filter: is:todo -is:complete #dotflowy, has:link, highlight:red, is:agent, is:mirror, phrases, negation, and adjacent-term OR. Tags are exact and case-sensitive; text is case-insensitive. Mirrors match source content. Spoiler interiors cannot match. Returns readable text and structured nodes with ids and breadcrumbs. Pages default to 25 matches; use nextCursor until null for a complete list. Restart if searchable data changes.",
    input: SearchInput,
    output: SearchPage,
    readOnly: true,
    handle: (input: typeof SearchInput.Type, store) =>
      Effect.gen(function* () {
        const index = yield* loadIndex(store);
        const page = yield* searchPage(index, input).pipe(
          Effect.mapError((error) => new ToolError({ reason: error.reason })),
        );
        const body = page.nodes
          .map((h) => {
            const path = h.path.length ? ` — in: ${h.path.join(" > ")}` : "";
            const meta = [`id: ${h.id}`];
            if (h.kind === "paragraph") meta.push("paragraph");
            if (h.mirrorOf) meta.push(`mirror of ${h.mirrorOf}`);
            if (h.completed) meta.push("completed");
            if (h.locked) meta.push("locked");
            return `- ${h.isTask ? (h.completed ? "[x] " : "[ ] ") : ""}"${h.text}" (${meta.join(", ")})${path}`;
          })
          .join("\n");
        const content: ToolResult["content"] = [
          {
            type: "text",
            text: body || `No nodes match "${input.query}".`,
          },
        ];
        if (page.nextCursor)
          content.push({
            type: "text",
            text: `More matches remain. Repeat the same query, scope, and limit with cursor: ${page.nextCursor}`,
          });
        return { content, structuredContent: page };
      }),
  },
  {
    name: "add_node",
    description:
      'Add a new bullet to the outline — under a parent node or at the top level. Pass kind: "paragraph" for prose. Returns the new node id.',
    input: AddNodeInput,
    readOnly: false,
    handle: (input: typeof AddNodeInput.Type, store, origin) =>
      Effect.gen(function* () {
        const index = yield* loadIndex(store);
        const timestamp = yield* clock;
        const plan = yield* unwrap(
          planAddNode(index, {
            id: createId(),
            text: input.text,
            parentId: input.parentId ?? null,
            position: input.position ?? "last",
            isTask: input.isTask ?? false,
            kind: input.kind ?? null,
            origin,
            timestamp,
          }),
        );
        yield* commit(store, plan.ops);
        const parentText = plan.parentId
          ? index.byId.get(plan.parentId)?.text
          : undefined;
        const where = plan.parentId
          ? `under "${parentText == null ? plan.parentId : redactSpoilers(parentText)}"`
          : "at the top level";
        return `Added "${redactSpoilers(input.text)}" ${where} (id: ${plan.nodeId}).`;
      }),
  },
  {
    name: "add_subtree",
    description:
      "Add a whole nested outline — a forest of bullets, each with its own children — in ONE atomic call. Use this instead of many add_node calls when building structure. Target a parent (parentId), the top level (omit both), or the user's daily note (date). Returns the created bullets with their ids.",
    input: AddSubtreeInput,
    readOnly: false,
    handle: (input: typeof AddSubtreeInput.Type, store, origin) =>
      Effect.gen(function* () {
        if (input.parentId != null && input.date != null) {
          return yield* Effect.fail(
            new ToolError({ reason: "pass either parentId or date, not both" }),
          );
        }
        const timestamp = yield* clock;

        // Daily path: claim the container + day ids atomically, then ensure-and-
        // append the forest under the day (position is ignored — always last).
        if (input.date != null) {
          const dateKey = yield* resolveDateKey(
            input.date,
            input.timeZone,
            timestamp,
          );
          // Validate the forest BEFORE claiming any daily-index ids, so an empty
          // or over-cap forest can't leave orphan container/day mappings pointing
          // at nodes we never insert (ADR 0028 all-or-nothing).
          const sizeError = guardForestSize(input.nodes, MAX_BATCH_NODES);
          if (sizeError != null) {
            return yield* Effect.fail(
              new ToolError({ reason: sizeError.message }),
            );
          }
          const scaffold = yield* claimDailyScaffold(store, dateKey);
          // Reuse the index claimDailyScaffold already built -- only kv claims ran
          // since, so a reload would rebuild the identical tree (finding 6).
          const index = scaffold.index;
          const plan = yield* unwrap(
            planAddSubtreeToDaily(index, {
              nodes: input.nodes,
              dateKey,
              ...scaffold,
              origin,
              timestamp,
              newId: createId,
              maxNodes: MAX_BATCH_NODES,
            }),
          );
          yield* commit(store, plan.ops, scaffold.weekStart);
          return mcpReceipt(
            `Added ${plan.rootIds.length} bullet(s) to ${formatDayText(dateKey)} (daily note id: ${scaffold.dayId}):\n${renderCreatedForest(plan.ops, plan.rootIds)}`,
          );
        }

        // Parent (or top-level) path.
        const index = yield* loadIndex(store);
        const plan = yield* unwrap(
          planAddSubtree(index, {
            nodes: input.nodes,
            parentId: input.parentId ?? null,
            position: input.position ?? "last",
            origin,
            timestamp,
            newId: createId,
            maxNodes: MAX_BATCH_NODES,
          }),
        );
        yield* commit(store, plan.ops);
        const where = plan.parentId
          ? `under "${index.byId.get(plan.parentId)?.text ?? plan.parentId}"`
          : "at the top level";
        const kind = plan.parentId ? "bullet(s)" : "top-level bullet(s)";
        return mcpReceipt(
          `Added ${plan.rootIds.length} ${kind} ${where}:\n${renderCreatedForest(plan.ops, plan.rootIds)}`,
        );
      }),
  },
  {
    name: "update_node",
    description:
      "Edit a node's text, to-do state, done state, or collapsed state. Editing a mirror edits the shared content everywhere it appears. WARNING: spoiler runs (||...||) are redacted to `[spoiler]` when you read a node, so passing that read-back text as the new `text` DESTROYS the hidden spoiler content. When editing a node that shows `[spoiler]`, ask the user for the intended full text instead of writing back what you were given.",
    input: UpdateNodeInput,
    readOnly: false,
    handle: (input: typeof UpdateNodeInput.Type, store) =>
      Effect.gen(function* () {
        // Built field by field: only present fields are edited (absent =
        // untouched); `"bullet"` is the explicit kind reset (stored nullable).
        const changes: NodeFieldChanges = {};
        if (input.text != null) changes.text = input.text;
        if (input.isTask != null) changes.isTask = input.isTask;
        if (input.completed != null) changes.completed = input.completed;
        if (input.collapsed != null) changes.collapsed = input.collapsed;
        if (input.kind != null)
          changes.kind = input.kind === "paragraph" ? "paragraph" : null;
        if (!Object.keys(changes).length) {
          return yield* Effect.fail(
            new ToolError({
              reason:
                "nothing to change — pass at least one of text, isTask, completed, collapsed, kind",
            }),
          );
        }
        const index = yield* loadIndex(store);
        const scaffold = yield* loadDailyReverseMap(store);
        yield* guardScaffoldUpdate(index, scaffold, input.nodeId, changes);
        const timestamp = yield* clock;
        const plan = yield* unwrap(
          planUpdateNode(index, { nodeId: input.nodeId, changes, timestamp }),
        );
        yield* commit(store, plan.ops);
        return `Updated ${Object.keys(changes).join(", ")} on node ${input.nodeId}.`;
      }),
  },
  {
    name: "delete_node",
    description:
      "Delete a node and its whole subtree. This cannot be undone by the agent.",
    input: DeleteNodeInput,
    readOnly: false,
    handle: (input: typeof DeleteNodeInput.Type, store) =>
      Effect.gen(function* () {
        const index = yield* loadIndex(store);
        const scaffold = yield* loadDailyReverseMap(store);
        const timestamp = yield* clock;
        const plan = yield* unwrap(
          planDeleteNode(index, input.nodeId, timestamp),
        );
        yield* guardScaffoldDelete(scaffold, plan.deletedIds);
        yield* commit(store, plan.ops);
        return `Deleted ${plan.deletedIds.length} node(s) (node ${input.nodeId} and its subtree).`;
      }),
  },
  {
    name: "move_nodes",
    description:
      "Move existing nodes (each with its subtree) under a new parent, or to the top level. Preserves node ids, mirrors, and all state — it reorganizes, it never recreates. The order you pass nodeIds is kept.",
    input: MoveNodesInput,
    readOnly: false,
    handle: (input: typeof MoveNodesInput.Type, store) =>
      Effect.gen(function* () {
        const index = yield* loadIndex(store);
        const timestamp = yield* clock;
        const position = input.position ?? "last";
        const plan = yield* unwrap(
          planReparent(index, {
            nodeIds: input.nodeIds,
            newParentId: input.newParentId ?? null,
            position,
            timestamp,
          }),
        );
        yield* commit(store, plan.ops);
        // An empty plan committed nothing (no nodes given, or every node was
        // already exactly where asked) — say so rather than claim a phantom move.
        if (plan.ops.length === 0) {
          return input.nodeIds.length === 0
            ? "No nodes to move."
            : "No change — the node(s) are already in that position.";
        }
        const where = plan.parentId
          ? `under "${index.byId.get(plan.parentId)?.text ?? plan.parentId}" (id: ${plan.parentId})`
          : "to the top level";
        const noun = plan.parentId ? "children" : "items";
        const pos =
          position === "first" ? `as the first ${noun}` : `as the last ${noun}`;
        return mcpReceipt(
          `Moved ${plan.movedIds.length} node(s) ${where} ${pos}.`,
        );
      }),
  },
  {
    name: "add_to_today",
    description:
      "Add a new bullet to the user's daily note, creating today's note (and the Daily container) if needed. One of the fastest ways to capture something for the user.",
    input: AddToTodayInput,
    readOnly: false,
    handle: (input: typeof AddToTodayInput.Type, store, origin) =>
      Effect.gen(function* () {
        const now = yield* clock;
        const dateKey = yield* resolveDateKey(input.date, input.timeZone, now);
        const scaffold = yield* claimDailyScaffold(store, dateKey);
        // Reuse the index claimDailyScaffold already built -- only kv claims ran
        // since, so a reload would rebuild the identical tree (finding 6).
        const index = scaffold.index;
        const timestamp = now;
        const plan = planAddToDaily(index, {
          dateKey,
          ...scaffold,
          newNodeId: createId(),
          text: input.text,
          isTask: input.isTask ?? false,
          kind: input.kind ?? null,
          origin,
          timestamp,
        });
        yield* commit(store, plan.ops, scaffold.weekStart);
        return mcpReceipt(
          `Added "${input.text}" to ${formatDayText(dateKey)} (node id: ${plan.nodeId}, daily note id: ${scaffold.dayId}).`,
        );
      }),
  },
  {
    name: "mirror_node",
    description:
      "Mirror a node (a live synced instance, like a Notion synced block) into another parent — the node appears in both places and edits sync. Omit parentId to mirror to the top level.",
    input: MirrorNodeInput,
    readOnly: false,
    handle: (input: typeof MirrorNodeInput.Type, store, origin) =>
      Effect.gen(function* () {
        const index = yield* loadIndex(store);
        const timestamp = yield* clock;
        const plan = yield* unwrap(
          planMirrorNode(index, {
            sourceId: input.nodeId,
            targetParentId: input.parentId ?? null,
            id: createId(),
            origin,
            timestamp,
          }),
        );
        yield* commit(store, plan.ops);
        const where = input.parentId
          ? `under "${index.byId.get(trueSourceOf(index, input.parentId))?.text ?? input.parentId}"`
          : "at the top level";
        return mcpReceipt(
          `Mirrored node ${plan.sourceId} ${where} (mirror id: ${plan.nodeId}).`,
        );
      }),
  },
  {
    name: "mirror_to_today",
    description:
      "Mirror an existing node onto the user's daily note — it stays where it is AND appears under today, fully synced. Creates today's note if needed.",
    input: MirrorToTodayInput,
    readOnly: false,
    handle: (input: typeof MirrorToTodayInput.Type, store, origin) =>
      Effect.gen(function* () {
        const now = yield* clock;
        const dateKey = yield* resolveDateKey(input.date, input.timeZone, now);
        const scaffold = yield* claimDailyScaffold(store, dateKey);
        // Reuse the index claimDailyScaffold already built -- only kv claims ran
        // since, so a reload would rebuild the identical tree (finding 6).
        const index = scaffold.index;
        const timestamp = now;
        const plan = yield* unwrap(
          planMirrorToDaily(index, {
            dateKey,
            ...scaffold,
            sourceId: input.nodeId,
            mirrorId: createId(),
            origin,
            timestamp,
          }),
        );
        yield* commit(store, plan.ops, scaffold.weekStart);
        return `Mirrored node ${plan.sourceId} onto ${formatDayText(dateKey)} (mirror id: ${plan.nodeId}, daily note id: ${scaffold.dayId}).`;
      }),
  },
  {
    name: "import_opml",
    description:
      "Import an OPML document (e.g. a Workflowy export) as new bullets — under a parent (parentId), onto the user's daily note (date), or at the top level. Lands as ONE atomic batch and returns a compact receipt (root ids, counts, any fidelity degradations), never the echoed outline. Ceiling: 5,000 nodes — a full Workflowy migration belongs in the app's own OPML import. Pass dryRun to preview the receipt without writing.",
    input: ImportOpmlInput,
    readOnly: false,
    handle: (input: typeof ImportOpmlInput.Type, store, origin) =>
      Effect.gen(function* () {
        if (input.parentId != null && input.date != null) {
          return yield* Effect.fail(
            new ToolError({ reason: "pass either parentId or date, not both" }),
          );
        }
        const dryRun = input.dryRun ?? false;
        // The shared core (src/data/opml-import.ts) owns parse + mapping +
        // degradation counting — this handler is a thin shell over it, so the
        // MCP surface can't drift from the app importer (ADR 0037).
        const { forest, report } = yield* parseOpml(input.opml).pipe(
          Effect.mapError((e) => new ToolError({ reason: e.message })),
        );
        // Ceiling + emptiness BEFORE any kv claim or plan (the add_subtree
        // guard-before-claim rule, ADR 0028) — counted post-split by the shared
        // core, so the two surfaces can't disagree on what "too big" means.
        if (report.nodesPost === 0) {
          return yield* Effect.fail(
            new ToolError({
              reason: "the OPML document contains no outline nodes",
            }),
          );
        }
        if (report.nodesPost > OPML_MCP_MAX_NODES) {
          return yield* Effect.fail(
            new ToolError({
              reason: `too many nodes to import: ${report.nodesPost} exceeds the ${OPML_MCP_MAX_NODES}-node ceiling for import_opml — for a large or full migration, use the app's own OPML import instead`,
            }),
          );
        }
        const timestamp = yield* clock;
        const rootTexts = forest.map((n) => n.text);

        // Daily path (mirrors add_subtree's date targeting: always appends).
        if (input.date != null) {
          const dateKey = yield* resolveDateKey(
            input.date,
            input.timeZone,
            timestamp,
          );
          if (dryRun) {
            // A dry run must not claim daily-index ids (a kv claim IS a write);
            // plan against a detached parent purely for the receipt's counts.
            const plan = yield* unwrap(
              planOpmlImport(forest, {
                parentId: null,
                firstPrev: null,
                origin,
                timestamp,
                newId: createId,
                maxNodes: OPML_MCP_MAX_NODES,
              }),
            );
            return mcpReceipt(
              renderImportReceipt({
                report,
                rootIds: plan.rootIds,
                rootTexts,
                landing: `onto ${formatDayText(dateKey)}`,
                dryRun: true,
              }),
            );
          }
          const scaffold = yield* claimDailyScaffold(store, dateKey);
          // Reuse the index claimDailyScaffold already built -- only kv claims ran
          // since, so a reload would rebuild the identical tree (finding 6).
          const index = scaffold.index;
          const ensure = planEnsureDaily(index, {
            dateKey,
            ...scaffold,
            timestamp,
          });
          const siblings = index.byId.has(scaffold.dayId)
            ? childrenOf(index, scaffold.dayId)
            : [];
          const firstPrev = siblings.length
            ? siblings[siblings.length - 1]!.id
            : null;
          const plan = yield* unwrap(
            planOpmlImport(forest, {
              parentId: scaffold.dayId,
              firstPrev,
              origin,
              timestamp,
              newId: createId,
              maxNodes: OPML_MCP_MAX_NODES,
            }),
          );
          yield* commit(
            store,
            [...ensure.ops, ...plan.ops],
            scaffold.weekStart,
          );
          return mcpReceipt(
            renderImportReceipt({
              report,
              rootIds: plan.rootIds,
              rootTexts,
              landing: `onto ${formatDayText(dateKey)} (daily note id: ${scaffold.dayId})`,
              dryRun: false,
            }),
          );
        }

        // Parent (or top-level) path. No synthetic wrapper container — the
        // fresh-container rule is app-UI presentation, not data semantics.
        const index = yield* loadIndex(store);
        let parentId: string | null = null;
        if (input.parentId != null) {
          if (!index.byId.has(input.parentId)) {
            return yield* Effect.fail(
              new ToolError({ reason: `node not found: ${input.parentId}` }),
            );
          }
          parentId = trueSourceOf(index, input.parentId);
        }
        const siblings = childrenOf(index, parentId);
        const firstPrev = siblings.length
          ? siblings[siblings.length - 1]!.id
          : null;
        const plan = yield* unwrap(
          planOpmlImport(forest, {
            parentId,
            firstPrev,
            origin,
            timestamp,
            newId: createId,
            maxNodes: OPML_MCP_MAX_NODES,
          }),
        );
        if (!dryRun) yield* commit(store, plan.ops);
        const landing = parentId
          ? `under "${index.byId.get(parentId)?.text ?? parentId}" (id: ${parentId})`
          : "at the top level";
        return mcpReceipt(
          renderImportReceipt({
            report,
            rootIds: plan.rootIds,
            rootTexts,
            landing,
            dryRun,
          }),
        );
      }),
  },
  {
    name: "export_opml",
    description:
      "Export the outline (or one node and its whole subtree via nodeId) as an OPML 2.0 document in the Workflowy dialect. Returns the raw OPML string with no preamble. Ceiling: 5,000 nodes — pass nodeId to scope a large outline.",
    input: ExportOpmlInput,
    readOnly: true,
    handle: (input: typeof ExportOpmlInput.Type, store) =>
      Effect.gen(function* () {
        const index = yield* loadIndex(store);
        const rootId = input.nodeId ?? null;
        if (rootId !== null && !index.byId.has(rootId)) {
          return yield* Effect.fail(
            new ToolError({ reason: `node not found: ${rootId}` }),
          );
        }
        // The same walk the serializer performs (mirror windows included, cycle
        // caps identical) sizes the scope; over the ceiling the WHOLE call is
        // refused — truncated OPML that still parses is silent loss (ADR 0037).
        const flat = yield* unwrap(
          flattenSubtree(index, rootId, {
            maxDepth: Number.POSITIVE_INFINITY,
            maxNodes: Number.POSITIVE_INFINITY,
          }),
        );
        if (flat.lines.length > OPML_MCP_MAX_NODES) {
          return yield* Effect.fail(
            new ToolError({
              reason: `the export scope holds ${flat.lines.length} nodes, over the ${OPML_MCP_MAX_NODES}-node ceiling for export_opml — pass a nodeId to export a smaller subtree, or use the app's own OPML export for the whole outline`,
            }),
          );
        }
        const rootNode =
          rootId !== null ? index.byId.get(trueSourceOf(index, rootId)) : null;
        // MCP egress: redact spoilers before serializing (ADR 0043). Redact the
        // title too -- a spoiler-bearing root node's text becomes the <title>.
        // The shared exportOpml walk stays verbatim; it's fed a redacted index.
        const title = rootNode?.text.trim()
          ? redactSpoilers(rootNode.text)
          : "dotflowy";
        return exportOpml(redactSpoilerIndex(index), rootId, { title });
      }),
  },
  {
    name: "list_library",
    description:
      "List the user's library: the folders and notes in the app's sidebar, with folder ids and each note's top-level node id (read a note with get_outline on that id), followed by the top-level nodes not filed in any folder.",
    input: ListLibraryInput,
    readOnly: true,
    handle: (_input: typeof ListLibraryInput.Type, store) =>
      Effect.gen(function* () {
        const [index, { rows }, daily] = yield* Effect.all(
          [loadIndex(store), loadLibrary(store), loadDailyReverseMap(store)],
          { concurrency: "unbounded" },
        );
        const topLevel = childrenOf(index, null).map((n) => n.id);
        const tree = buildLibraryTree(rows, new Set(topLevel));
        const container = [...daily].find(([, key]) => key === CONTAINER_KEY);
        const unfiled = unfiledNodeIds(
          topLevel,
          tree,
          new Set(container ? [container[0]] : []),
        );
        const lines = renderLibrary(tree, index);
        const unfiledLines = unfiled
          .slice(0, MAX_UNFILED_LISTED)
          .map((id) => `- ${noteTitle(index, id)} (node id: ${id})`);
        const more =
          unfiled.length > MAX_UNFILED_LISTED
            ? [`(and ${unfiled.length - MAX_UNFILED_LISTED} more)`]
            : [];
        return [
          lines.length
            ? lines.join("\n")
            : "The library has no folders or notes yet.",
          "",
          unfiled.length
            ? `Unfiled top-level nodes (${unfiled.length}):\n${[...unfiledLines, ...more].join("\n")}`
            : "Every top-level node is filed.",
        ].join("\n");
      }),
  },
  {
    name: "create_folder",
    description:
      "Create a folder in the user's library (the app's sidebar), at the end of the library or of another folder. Returns the folder id.",
    input: CreateFolderInput,
    readOnly: false,
    handle: (input: typeof CreateFolderInput.Type, store) =>
      Effect.gen(function* () {
        const title = input.title.trim();
        if (!title)
          return yield* Effect.fail(
            new ToolError({ reason: "the folder needs a title" }),
          );
        const { rows } = yield* loadLibrary(store);
        const parentId = input.parentFolderId ?? null;
        if (parentId !== null) yield* requireFolder(rows, parentId);
        const folder: LibraryRow = {
          id: libraryId("f"),
          type: "folder",
          parentId,
          rank: rankForDrop(rowsInFolder(rows, parentId), null),
          title,
        };
        yield* saveLibrary(store, [folder]);
        return mcpReceipt(
          `Created folder "${title}" (folder id: ${folder.id}).`,
        );
      }),
  },
  {
    name: "create_note",
    description:
      'Create a note: a new top-level bullet titled `title`, optionally with a nested outline under it, filed in a library folder — by default the "Agent" folder, where the user expects agent-made notes. Returns the note\'s node id and the created bullets.',
    input: CreateNoteInput,
    readOnly: false,
    handle: (input: typeof CreateNoteInput.Type, store, origin) =>
      Effect.gen(function* () {
        const title = input.title.trim();
        if (!title)
          return yield* Effect.fail(
            new ToolError({ reason: "the note needs a title" }),
          );
        // Resolve the folder BEFORE writing any node, so a bad folder id
        // leaves nothing behind.
        const [library, index] = yield* Effect.all(
          [loadLibrary(store), loadIndex(store)],
          { concurrency: "unbounded" },
        );
        const { rows } = library;
        if (input.folderId != null) yield* requireFolder(rows, input.folderId);
        const timestamp = yield* clock;
        const plan = yield* unwrap(
          planAddSubtree(index, {
            nodes: [{ text: title, children: input.children ?? [] }],
            parentId: null,
            position: "last",
            origin,
            timestamp,
            newId: createId,
            maxNodes: MAX_BATCH_NODES,
          }),
        );
        yield* commit(store, plan.ops);
        const nodeId = plan.rootIds[0]!;

        // Not atomic with the node write (kv and nodes are separate stores): if
        // filing fails, the note still exists, unfiled, and the error says so.
        const filed = Effect.gen(function* () {
          const folder =
            input.folderId != null
              ? { id: input.folderId, title: undefined }
              : yield* claimAgentFolder(store, library);
          yield* saveLibrary(store, [
            {
              id: libraryId("n"),
              type: "note",
              parentId: folder.id,
              rank: rankForDrop(rowsInFolder(rows, folder.id), null),
              rootNodeId: nodeId,
            },
          ]);
          return folder;
        }).pipe(
          Effect.mapError(
            (e) =>
              new ToolError({
                reason: `created the note (node id: ${nodeId}) but could not file it: ${e.reason}`,
              }),
          ),
        );
        const folder = yield* filed;
        const folderName = redactSpoilers(
          folder.title ??
            rows.find((r) => r.id === folder.id)?.title ??
            folder.id,
        );
        return mcpReceipt(
          `Created note "${title}" (node id: ${nodeId}) in folder "${folderName}":\n${renderCreatedForest(plan.ops, plan.rootIds)}`,
        );
      }),
  },
  {
    name: "move_note",
    description:
      "Move a note to another library folder, or to the top of the library. Passing an unfiled top-level node files it as a note. Only the sidebar changes; the outline itself is untouched.",
    input: MoveNoteInput,
    readOnly: false,
    handle: (input: typeof MoveNoteInput.Type, store) =>
      Effect.gen(function* () {
        const [index, library, daily] = yield* Effect.all(
          [loadIndex(store), loadLibrary(store), loadDailyReverseMap(store)],
          { concurrency: "unbounded" },
        );
        const node = index.byId.get(input.nodeId);
        if (!node)
          return yield* Effect.fail(
            new ToolError({ reason: `no node with id "${input.nodeId}"` }),
          );
        if (node.parentId !== null)
          return yield* Effect.fail(
            new ToolError({
              reason: `node "${input.nodeId}" is not top-level, and only top-level nodes are notes — move it to the top level with move_nodes first`,
            }),
          );
        if (daily.get(node.id) === CONTAINER_KEY)
          return yield* Effect.fail(
            new ToolError({
              reason:
                "the Daily container has its own sidebar entry and can't be filed in a folder",
            }),
          );
        const { rows, records } = library;
        const folderId = input.folderId ?? null;
        if (folderId !== null) yield* requireFolder(rows, folderId);
        // Every row filing this node moves (a second one, filed from a device
        // that hadn't refetched, would otherwise keep showing it where it was).
        const existing = rows.filter(
          (r) => r.type === "note" && r.rootNodeId === node.id,
        );
        const moving = new Set(existing.map((r) => r.id));
        const siblings = rowsInFolder(rows, folderId).filter(
          (r) => !moving.has(r.id),
        );
        const next =
          input.position === "first" ? (siblings[0]?.rank ?? null) : null;
        let prev =
          input.position === "first" ? null : (siblings.at(-1)?.rank ?? null);
        const placed: LibraryRow[] = [];
        for (const row of existing.length
          ? existing
          : [
              {
                id: libraryId("n"),
                type: "note" as const,
                parentId: folderId,
                rank: "",
                rootNodeId: node.id,
              },
            ]) {
          const rank = rankBetween(prev, next);
          placed.push({ ...row, parentId: folderId, rank });
          prev = rank;
        }
        yield* saveLibrary(store, placed, records);
        const where =
          folderId === null
            ? "the top of the library"
            : `folder "${redactSpoilers(rows.find((r) => r.id === folderId)?.title ?? folderId)}"`;
        return mcpReceipt(
          `${existing.length ? "Moved" : "Filed"} note "${noteTitle(index, node.id)}" to ${where}.`,
        );
      }),
  },
];
