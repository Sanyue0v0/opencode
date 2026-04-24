import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { EOL } from "os"
import { UI } from "./cli/ui"
import { InstallationVersion } from "./installation/version"
import { shouldSkipCLIInit } from "./cli/bootstrap"

const args = hideBin(process.argv)

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("opencode ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text)
    return
  }
  process.stderr.write(out)
}

if (shouldSkipCLIInit(args)) {
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
      show(out)
    })
  } else {
    await cli.parse()
  }
  process.exit(0)
} else {
  const { runCLI } = await import("./cli/main")
  await runCLI(args)
}
