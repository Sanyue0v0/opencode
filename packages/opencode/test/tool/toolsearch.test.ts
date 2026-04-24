import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { ToolSearchTool, TOOLSEARCH_EXTRA_KEY } from "../../src/tool/toolsearch"
import * as Truncate from "../../src/tool/truncate"

const agent = {
  name: "test",
  mode: "primary",
  options: {},
  permission: [],
} as any

const mockAgent = {
  get: () => Effect.succeed(agent),
  list: () => Effect.succeed([agent]),
  defaultAgent: () => Effect.succeed(agent.name),
  generate: () => Effect.die("not implemented"),
}

const mockTruncate = {
  cleanup: () => Effect.void,
  write: () => Effect.succeed("/tmp/tool-output"),
  output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
  limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 50 * 1024 }),
}

describe("tool.toolsearch", () => {
  test("returns anthropic tool references for matched deferred tools", async () => {
    const info = await Effect.runPromise(
      ToolSearchTool.pipe(
        Effect.provideService(Agent.Service, mockAgent),
        Effect.provideService(Truncate.Service, mockTruncate),
      ),
    )
    const def = await Effect.runPromise(info.init())
    const result = await Effect.runPromise(
      def.execute(
        { query: "select:skill,task" },
        {
          sessionID: "s1" as any,
          messageID: "m1" as any,
          agent: "test",
          abort: new AbortController().signal,
          messages: [],
          extra: {
            model: { api: { npm: "@ai-sdk/anthropic" } },
            [TOOLSEARCH_EXTRA_KEY]: {
              skill: { description: "Skill tool", parameters: { type: "object" }, searchHint: "skill docs" },
              task: { description: "Task tool", parameters: { type: "object" }, searchHint: "task planner" },
            },
          },
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      ),
    )

    expect(result.metadata.matches).toStrictEqual(["skill", "task"])
    expect(result.content).toStrictEqual([
      { type: "tool_reference", toolName: "skill" },
      { type: "tool_reference", toolName: "task" },
    ])
  })
})
