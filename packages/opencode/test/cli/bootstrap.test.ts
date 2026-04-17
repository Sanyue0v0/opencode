import { describe, expect, test } from "bun:test"
import { shouldSkipCLIInit } from "../../src/cli/bootstrap"

describe("cli.bootstrap", () => {
  test("skips heavy init for help and version flags", () => {
    expect(shouldSkipCLIInit(["--help"])).toBe(true)
    expect(shouldSkipCLIInit(["-h"])).toBe(true)
    expect(shouldSkipCLIInit(["--version"])).toBe(true)
    expect(shouldSkipCLIInit(["-v"])).toBe(true)
    expect(shouldSkipCLIInit(["run", "--help"])).toBe(true)
  })

  test("does not skip heavy init for normal invocations", () => {
    expect(shouldSkipCLIInit([])).toBe(false)
    expect(shouldSkipCLIInit(["run", "hello"])).toBe(false)
    expect(shouldSkipCLIInit(["serve", "--port", "3000"])).toBe(false)
  })
})
