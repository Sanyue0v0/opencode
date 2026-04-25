import { EOL } from "os"

const informationalArgs = new Set(["-h", "--help", "-v", "--version"])
const args = process.argv.slice(2)

function shouldSkipCLIInit(args: string[]) {
  return args.some((arg) => informationalArgs.has(arg))
}

function show(out: string, logo?: string) {
  const text = out.trimStart()
  if (!text.startsWith("opencode ")) {
    if (logo) process.stderr.write(logo + EOL + EOL)
    process.stderr.write(text)
    return
  }
  process.stderr.write(out)
}

if (shouldSkipCLIInit(args)) {
  const [{ default: yargs }, { InstallationVersion }, { UI }] = await Promise.all([
    import("yargs"),
    import("./installation/version"),
    import("./cli/ui"),
  ])
  const logo = UI.logo()
  const cli = yargs(args)
    .parserConfiguration({ "populate--": true })
    .scriptName("opencode")
    .wrap(100)
    .help("help", "show help")
    .alias("help", "h")
    .version("version", "show version number", InstallationVersion)
    .alias("version", "v")
    .usage("")

  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out, logo)
    })
  } else {
    await cli.parse()
  }
  process.exit(0)
}

const { runCLI } = await import("./cli/main")
await runCLI(args)
