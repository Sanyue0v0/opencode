import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import type { MessageV2 } from "../session/message-v2"

const parameters = z.object({
  query: z
    .string()
    .describe(
      'Query to find deferred tools. Use "select:<tool_name>" (comma-separated "select:A,B,C" for multi-select) for direct selection, or keywords to search.',
    ),
  max_results: z.number().int().positive().optional().describe("Maximum number of results (default: 5)"),
})

type Metadata = {
  query: string
  matches: string[]
  total_deferred: number
}

const DESCRIPTION = `Fetches full schema definitions for deferred tools so they can be called.

Deferred tools appear by name in <available-deferred-tools> system messages. Until fetched, only the name is known — there is no parameter schema, so the tool cannot be invoked. This tool takes a query, matches it against the deferred tool list, and returns the matched tools' complete JSONSchema definitions inside a <functions> block. Once a tool's schema appears in that result, it becomes callable on subsequent turns exactly like any tool defined at the top of the prompt.

Result format: each matched tool appears as one <function>{"description": "...", "name": "...", "parameters": {...}}</function> line inside the <functions> block.

Query forms:
- "select:slack_send_message,github_list_repos" — fetch these exact tools by name
- "notebook jupyter" — keyword search, up to max_results best matches
- "+slack send" — require "slack" in the name, rank by remaining terms`

export type DeferredToolEntry = {
  description: string
  parameters: unknown
  searchHint?: string
}

export const TOOLSEARCH_EXTRA_KEY = "deferredTools"

function isAnthropicModel(model: unknown) {
  if (!model || typeof model !== "object") return false
  const npm = (model as { api?: { npm?: unknown } }).api?.npm
  return npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic"
}

function toolReferences(matches: string[]): MessageV2.ToolReferenceContent[] {
  return matches.map((toolName) => ({
    type: "tool_reference",
    toolName,
  }))
}

function parseToolName(name: string) {
  if (name.startsWith("mcp__")) {
    const stripped = name.slice(5).toLowerCase()
    const parts = stripped
      .split("__")
      .flatMap((p) => p.split("_"))
      .filter(Boolean)
    return { parts, full: stripped.replace(/__/g, " ").replace(/_/g, " "), isMcp: true }
  }
  const parts = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  return { parts, full: parts.join(" "), isMcp: false }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function renderFunctions(matches: string[], deferred: Record<string, DeferredToolEntry>): string {
  if (matches.length === 0) return "No matching deferred tools found."
  const lines = matches
    .map((name) => {
      const entry = deferred[name]
      if (!entry) return null
      return `<function>${JSON.stringify({
        name,
        description: entry.description,
        parameters: entry.parameters,
      })}</function>`
    })
    .filter((x): x is string => x !== null)

  return [
    `Matched ${lines.length} deferred tool(s). They are now loaded and callable on subsequent turns.`,
    "<functions>",
    ...lines,
    "</functions>",
  ].join("\n")
}

export const ToolSearchTool = Tool.define<typeof parameters, Metadata, never>(
  "toolsearch",
  Effect.succeed({
    description: DESCRIPTION,
    parameters,
    alwaysLoad: true,
    searchHint: "load deferred tool schemas",
    execute: (input: z.infer<typeof parameters>, ctx: Tool.Context<Metadata>) =>
      Effect.gen(function* () {
        const max = input.max_results ?? 5
        const deferred = (ctx.extra?.[TOOLSEARCH_EXTRA_KEY] ?? {}) as Record<string, DeferredToolEntry>
        const names = Object.keys(deferred).sort()
        const totalDeferred = names.length

        const emptyResult = (queryType: string) => ({
          title: `toolsearch: ${queryType} → 0`,
          output: renderFunctions([], deferred),
          metadata: { query: input.query, matches: [], total_deferred: totalDeferred },
        })

        // select: prefix → direct selection
        const selectMatch = input.query.match(/^select:(.+)$/i)
        if (selectMatch) {
          const requested = selectMatch[1]!
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
          const found: string[] = []
          for (const req of requested) {
            const exact =
              names.find((n) => n === req) ??
              names.find((n) => n.toLowerCase() === req.toLowerCase())
            if (exact && !found.includes(exact)) found.push(exact)
          }
          return {
            title: `toolsearch: select → ${found.length}`,
            output: renderFunctions(found, deferred),
            metadata: { query: input.query, matches: found, total_deferred: totalDeferred },
            ...(isAnthropicModel(ctx.extra?.model) && found.length > 0 ? { content: toolReferences(found) } : {}),
          }
        }

        if (totalDeferred === 0) return emptyResult("keyword")

        const q = input.query.toLowerCase().trim()

        // exact-name fallback (model may pass bare tool name instead of select:)
        const exact = names.find((n) => n.toLowerCase() === q)
        if (exact) {
          return {
            title: `toolsearch: exact → 1`,
            output: renderFunctions([exact], deferred),
            metadata: { query: input.query, matches: [exact], total_deferred: totalDeferred },
            ...(isAnthropicModel(ctx.extra?.model) ? { content: toolReferences([exact]) } : {}),
          }
        }

        // keyword search
        const terms = q.split(/\s+/).filter(Boolean)
        if (terms.length === 0) return emptyResult("keyword")

        const required: string[] = []
        const optional: string[] = []
        for (const t of terms) {
          if (t.startsWith("+") && t.length > 1) required.push(t.slice(1))
          else optional.push(t)
        }
        const all = required.length > 0 ? [...required, ...optional] : terms
        const patterns = new Map<string, RegExp>()
        for (const t of all) {
          if (!patterns.has(t)) patterns.set(t, new RegExp(`\\b${escapeRegExp(t)}\\b`))
        }

        const candidateNames = names.filter((name) => {
          if (required.length === 0) return true
          const parsed = parseToolName(name)
          const desc = (deferred[name]?.description ?? "").toLowerCase()
          const hint = (deferred[name]?.searchHint ?? "").toLowerCase()
          return required.every((term) => {
            const pat = patterns.get(term)!
            return (
              parsed.parts.includes(term) ||
              parsed.parts.some((part) => part.includes(term)) ||
              pat.test(desc) ||
              pat.test(hint)
            )
          })
        })

        const scored = candidateNames.map((name) => {
          const parsed = parseToolName(name)
          const desc = (deferred[name]?.description ?? "").toLowerCase()
          const hint = (deferred[name]?.searchHint ?? "").toLowerCase()
          let score = 0
          for (const term of all) {
            const pat = patterns.get(term)!
            if (parsed.parts.includes(term)) score += parsed.isMcp ? 12 : 10
            else if (parsed.parts.some((part) => part.includes(term))) score += parsed.isMcp ? 6 : 5
            else if (parsed.full.includes(term)) score += 3
            if (pat.test(hint)) score += 4
            if (pat.test(desc)) score += 2
          }
          return { name, score }
        })

        const matches = scored
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, max)
          .map((s) => s.name)

        return {
          title: `toolsearch: keyword → ${matches.length}`,
          output: renderFunctions(matches, deferred),
          metadata: { query: input.query, matches, total_deferred: totalDeferred },
          ...(isAnthropicModel(ctx.extra?.model) && matches.length > 0 ? { content: toolReferences(matches) } : {}),
        }
      }),
  } satisfies Tool.DefWithoutID<typeof parameters, Metadata>),
)
