# Headless CLI and MCP

EIDE can build, flash, and debug projects without a running VS Code instance. The
headless host loads the same `.eide/eide.yml` project model and generates build
parameters with the same `CodeBuilder` used by the extension, so build behavior
matches VS Code: all project types, all registered toolchains, `.eide/env.ini`,
virtual source folders, dependency groups, per-file options, and builder
settings are supported.

## Requirements

- Node.js 18+
- EIDE resources directory (`res`) and the toolchain configured for the target
- A project initialized by EIDE (`miscInfo.uid` is present in `.eide/eide.yml`)
- `--project` points at the directory containing `.eide/eide.yml`

## CLI

Build (incremental):

```bash
eide-cli build \
  --project ./firmware \
  --resources /opt/eide/res \
  --toolchain-path /opt/gcc-arm-none-eabi
```

Rebuild with per-invocation parameters:

```bash
eide-cli build \
  --project ./firmware \
  --resources ./res \
  --toolchain-path "C:/Program Files (x86)/GNU Arm Embedded Toolchain/10 2021.10" \
  --mode rebuild \
  -D FEATURE_LOG=1 \
  --cflag -O2 \
  --include ./extra-include
```

Generate the build plan without compiling:

```bash
eide-cli plan --project ./firmware --resources ./res --toolchain-path ./gcc
```

Clean the target output directory:

```bash
eide-cli clean --project ./firmware
```

Flash with a project uploader (JLink in this example):

```bash
eide-cli flash \
  --project ./firmware \
  --flasher-exe "C:/Program Files/SEGGER/JLink/JLink.exe"
```

Erase the chip, or inspect the flash command without touching hardware:

```bash
eide-cli flash --project ./firmware --flasher-exe ./JLink.exe --erase-all
eide-cli flash --project ./firmware --flasher-exe ./JLink.exe --dry-run
```

Options:

| Option | Meaning |
| --- | --- |
| `-p, --project <dir>` | Project root (required) |
| `--workspace <file>` | `.code-workspace` file instead of the project directory |
| `-t, --target <name>` | Build target |
| `--mode incremental\|rebuild` | Build mode |
| `--dry-run` | Return the plan/command without executing |
| `-D, --define <NAME[=VAL]>` | Extra preprocessor define (repeatable) |
| `--include`, `--lib` | Extra include/library directory (repeatable) |
| `--cflag`, `--cxxflag`, `--asmflag`, `--ldflag` | Extra compiler/linker flags (repeatable) |
| `--resources <dir>` | EIDE `res` directory (required for build/plan) |
| `--extension-root <dir>` | Extension root containing `package.json` and `res` (default: parent of `--resources`) |
| `--settings <file>` | JSON file with `EIDE.*` settings overrides, merged after `.code-workspace` settings |
| `--toolchain-path <dir>` | Toolchain installation directory (see below) |
| `--timeout <ms>` | Operation timeout (build 30 min, flash 2 min by default) |
| `--threads <n>` | Build worker threads (default: EIDE setting) |
| `--flasher-exe <path>` | Flash tool executable; required for JLink/OpenOCD/STLink |
| `--erase-all` | Chip erase instead of programming |
| `--verify`, `--no-verify` | Force or skip verification where the tool allows it |
| `--artifact <path[,addr]>` | Override the programmed artifact |

All commands print one JSON object to stdout. Logs go to stderr.

`--toolchain-path` is mapped to the toolchain's normal `EIDE.*` install setting:
the toolchain root for most compilers (the executable folder is derived as
`bin`, `stm8/bin`, or the folder itself for COSMIC STM8), and the `TOOLS.INI`
or `uv4.exe` path for Keil C51. Use `--settings` to set any toolchain setting
explicitly instead.

```json
{
  "EIDE.ARM.GCC.InstallDirectory": "/opt/gcc-arm-none-eabi",
  "EIDE.Builder.ThreadNumber": 8
}
```

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `2` | Build or flash operation failed |
| `3` | Invalid invocation, project configuration, or unsupported request |
| `4` | Failed to start the external tool |

Build results contain `success`, `stage`, `problems`, `memory`, `artifacts`,
`compileCommands` (when the builder produced `compile_commands.json`),
`effectiveConfig`, and `logTail` on failure. A manifest is written to
`<outDir>/<target>/build-manifest.json`. The compiler database can be fed
directly to clangd or other language servers.

The repository builds standalone entry scripts at `dist/eide_cli.js` and
`dist/eide_mcp.js` (`npm run webpack:headless`). Use `node dist/eide_cli.js`
and `node dist/eide_mcp.js` when running from a packaged extension. The MCP
bundle resolves `x2js` from the extension's `node_modules`.

## Build parity

`eide-cli plan/build` and the MCP `eide_build`/`eide_rebuild` tools reuse the
extension's project loader and builder:

- `.eide/env.ini` variables are applied to defines, include paths, and the
  builder environment, including target-specific sections.
- Virtual source folders and physical source roots are scanned together.
- `dependenceList` groups (custom and installed package groups) contribute
  include paths, libraries, and defines.
- `.eide/files.options.yml` per-file compiler options and
  `alwaysBuildSourceFiles` are passed to the builder.
- `.code-workspace` `settings` and the `--settings` file provide `EIDE.*`
  settings; `--settings` takes precedence and `--threads` overrides the
  configured thread count.
- GCC-family toolchains installed through xpack are resolved from the
  project `package.json` and `xpacks/` directory like in VS Code.
- Dynamic `overrides` for defines, include/library paths, compiler/linker
  flags, builder options, source filters, and environment variables are
  applied to the generated `builder.params`; a non-empty override set forces
  a rebuild.

## MCP server (stdio)

```bash
eide-mcp \
  --project ./firmware \
  --resources ./res \
  --toolchain-path ./gcc \
  --gdb ./gcc/bin/arm-none-eabi-gdb \
  --flasher-exe ./JLink.exe
```

MCP configuration example:

```json
{
  "mcpServers": {
    "eide-headless": {
      "command": "node",
      "args": [
        "/path/to/eide/dist/eide_mcp.js",
        "--project", "/path/to/firmware",
        "--resources", "/path/to/eide/res",
        "--toolchain-path", "/path/to/gcc",
        "--gdb", "/path/to/gcc/bin/arm-none-eabi-gdb"
      ]
    }
  }
}
```

The server exposes the same project/build tools as the VS Code MCP server:

- build/rebuild (with `overrides` and `dryRun`), clean, flash
- flash accepts the same `artifact`, `verify`, and `dryRun` inputs as the CLI
- targets, source dirs, include dirs, defines, builder options
- builder-options schema and validation for every registered toolchain
- stack usage and callgraph from `statistic.json`

It additionally exposes debug tools, backed by GDB/MI:

- `eide_debug_connect`, `eide_debug_disconnect`
- `eide_debug_read_register`, `eide_debug_read_memory`, `eide_debug_write_memory`
- `eide_debug_set_breakpoint`, `eide_debug_remove_breakpoint`
- `eide_debug_backtrace`, `eide_debug_list_breakpoints`
- `eide_debug_continue`, `eide_debug_interrupt`, `eide_debug_evaluate`
- `eide_debug_fault` (Cortex-M fault register decoding)
- `eide_debug_svd_lookup` (peripheral/register lookup by address or name)

Tool calls are serialized. A debug session stays active until
`eide_debug_disconnect` or server exit.

## Limits

- Flash support covers JLink, OpenOCD, pyOCD, STLink, and probe-rs.
  STVP, stcgal, and custom command uploaders fail explicitly.
- `eide_debug_svd_lookup` supports the SVD subset implemented in
  `src/core/debug/svd.ts`: peripheral/register/field `derivedFrom`, dimensions,
  address lookup, and field bit ranges. Enumerated values, clusters, and
  alternate register groups are not modeled.
