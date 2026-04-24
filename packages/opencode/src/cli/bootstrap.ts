const informationalArgs = new Set(["-h", "--help", "-v", "--version"])

export function shouldSkipCLIInit(args: string[]) {
  return args.some((arg) => informationalArgs.has(arg))
}

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  const { AppRuntime } = await import("@/effect/app-runtime")
  const { InstanceBootstrap } = await import("../project/bootstrap")
  const { Instance } = await import("../project/instance")

  return Instance.provide({
    directory,
    init: () => AppRuntime.runPromise(InstanceBootstrap),
    fn: async () => {
      try {
        const result = await cb()
        return result
      } finally {
        await Instance.dispose()
      }
    },
  })
}
