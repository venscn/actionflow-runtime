$ErrorActionPreference = "Continue"

$ReportDir = "reports"
$ReportPath = Join-Path $ReportDir "last-check.md"

New-Item -ItemType Directory -Force $ReportDir | Out-Null

function Add-Section {
  param(
    [string]$Title,
    [string]$Content
  )

  Add-Content -Path $ReportPath -Value ""
  Add-Content -Path $ReportPath -Value "## $Title"
  Add-Content -Path $ReportPath -Value ""
  Add-Content -Path $ReportPath -Value '```text'
  Add-Content -Path $ReportPath -Value $Content
  Add-Content -Path $ReportPath -Value '```'
}

function Run-Command {
  param(
    [string]$Title,
    [string]$Command
  )

  $output = cmd /c $Command 2>&1 | Out-String
  Add-Section -Title $Title -Content $output
}

function Should-IncludeFile {
  param([string]$Path)

  $normalized = $Path -replace "\\", "/"

  if ($normalized -match "^node_modules/") { return $false }
  if ($normalized -match "^dist/") { return $false }
  if ($normalized -match "^reports/") { return $false }
  if ($normalized -eq "package-lock.json") { return $false }

  if ($normalized -match "^src/.*\.ts$") { return $true }
  if ($normalized -match "^tests/.*\.ts$") { return $true }
  if ($normalized -match "^docs/.*\.md$") { return $true }
  if ($normalized -match "^examples/.*\.ts$") { return $true }
  if ($normalized -eq "README.md") { return $true }
  if ($normalized -eq "package.json") { return $true }
  if ($normalized -eq "tsconfig.json") { return $true }
  if ($normalized -eq "tsconfig.build.json") { return $true }
  if ($normalized -eq ".gitignore") { return $true }
  if ($normalized -eq "AGENTS.md") { return $true }

  return $false
}

Set-Content -Path $ReportPath -Value "# ActionFlow Runtime Check Report"
Add-Content -Path $ReportPath -Value ""
Add-Content -Path $ReportPath -Value "- GeneratedAt: $(Get-Date -Format o)"
Add-Content -Path $ReportPath -Value "- Location: $(Get-Location)"

Run-Command -Title "Git Log" -Command "git log --oneline -8"
Run-Command -Title "Git Status" -Command "git status --short"
Run-Command -Title "Git Diff Stat" -Command "git diff --stat"
Run-Command -Title "Typecheck" -Command "npm run typecheck"
Run-Command -Title "Test" -Command "npm test"
Run-Command -Title "Build" -Command "npm run build"

$packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
if ($packageJson.scripts."example:basic") {
  Run-Command -Title "Example Basic" -Command "npm run example:basic"
} else {
  Add-Section -Title "Example Basic" -Content "Skipped: package.json has no example:basic script."
}

$changed = git diff --name-only
$untracked = git ls-files --others --exclude-standard
$files = @($changed + $untracked) | Sort-Object -Unique

Add-Content -Path $ReportPath -Value ""
Add-Content -Path $ReportPath -Value "## Changed And Untracked Files"
Add-Content -Path $ReportPath -Value ""
Add-Content -Path $ReportPath -Value '```text'
foreach ($file in $files) {
  Add-Content -Path $ReportPath -Value $file
}
Add-Content -Path $ReportPath -Value '```'

Add-Content -Path $ReportPath -Value ""
Add-Content -Path $ReportPath -Value "## File Contents"

foreach ($file in $files) {
  if (-not (Should-IncludeFile $file)) {
    continue
  }

  if (-not (Test-Path $file)) {
    continue
  }

  Add-Content -Path $ReportPath -Value ""
  Add-Content -Path $ReportPath -Value "### $file"
  Add-Content -Path $ReportPath -Value ""
  Add-Content -Path $ReportPath -Value '```text'

  $content = Get-Content $file -Raw
  if ($content.Length -gt 60000) {
    Add-Content -Path $ReportPath -Value $content.Substring(0, 60000)
    Add-Content -Path $ReportPath -Value ""
    Add-Content -Path $ReportPath -Value "[TRUNCATED: file content exceeded 60000 characters]"
  } else {
    Add-Content -Path $ReportPath -Value $content
  }

  Add-Content -Path $ReportPath -Value '```'
}

Write-Host "Report written to $ReportPath"
