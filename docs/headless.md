# Headless CLI and MCP

EIDE can build, flash, and debug ARM GCC projects without a running VS Code instance.

## Requirements

- Node.js 18+
- EIDE resources directory (`res`) and an ARM GCC toolchain
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
| `--toolchain-path <dir>` | Toolchain root, containing `bin/arm-none-eabi-gcc` |
| `--timeout <ms>` | Operation timeout (build 30 min, flash 2 min by default) |
| `--threads <n>` | Build worker threads (default 4) |
| `--flasher-exe <path>` | Flash tool executable; required for JLink/OpenOCD/STLink |
| `--erase-all` | Chip erase instead of programming |
| `--verify`, `--no-verify` | Force or skip verification where the tool allows it |
| `--artifact <path[,addr]>` | Override the programmed artifact |

All commands print one JSON object to stdout. Logs go to stderr.

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
- targets, source dirs, include dirs, defines, builder options
- stack usage and callgraph from `statistic.json`

It additionally exposes debug tools, backed by GDB/MI:

- `eide_debug_connect`, `eide_debug_disconnect`
- `eide_debug_read_register`, `eide_debug_read_memory`, `eide_debug_write_memory`
- `eide_debug_set_breakpoint`, `eide_debug_remove_breakpoint`
- `eide_debug_continue`, `eide_debug_interrupt`, `eide_debug_evaluate`
- `eide_debug_fault` (Cortex-M fault register decoding)
- `eide_debug_svd_lookup` (peripheral/register lookup by address or name)

Tool calls are serialized. A debug session stays active until
`eide_debug_disconnect` or server exit.

## Limits

- Headless builds currently support ARM GCC projects without package
  dependencies, virtual source files, or `.eide/env.ini`.
- Flash support covers JLink, OpenOCD, pyOCD, STLink, and probe-rs.
  STVP, stcgal, and custom command uploaders fail explicitly.
- `eide_debug_svd_lookup` supports the SVD subset implemented in
  `src/core/debug/svd.ts` (no `derivedFrom`, enumerated values, or inherited
  access).
