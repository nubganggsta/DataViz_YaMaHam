$ErrorActionPreference = 'Stop'
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (Test-Path -LiteralPath $bundledNode) {
    $node = $bundledNode
} else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw 'Node.js was not found. Install Node.js or run this project in Codex Desktop.' }
    $node = $nodeCommand.Source
}
Set-Location -LiteralPath $PSScriptRoot
& $node (Join-Path $PSScriptRoot 'server.js')
