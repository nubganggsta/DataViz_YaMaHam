$ErrorActionPreference = 'Stop'
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (Test-Path -LiteralPath $bundledPython) {
    $python = $bundledPython
} else {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) { throw 'Python was not found. Install Python 3.10+ to rebuild the joined data.' }
    $python = $pythonCommand.Source
}
Set-Location -LiteralPath $PSScriptRoot
& $python (Join-Path $PSScriptRoot 'data\build_dashboard_data.py')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
