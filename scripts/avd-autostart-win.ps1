param(
  [switch]$Apply,
  [string]$TaskName = "AgentViewDaemon",
  [string]$Node = "node",
  [string]$AvdEntry = "avd"
)

function Quote-TaskArg([string]$Value) {
  return '"' + ($Value -replace '"', '\"') + '"'
}

$Action = "$(Quote-TaskArg $Node) $(Quote-TaskArg $AvdEntry)"
$Command = "schtasks /Create /TN $(Quote-TaskArg $TaskName) /SC ONLOGON /TR $(Quote-TaskArg $Action) /F"

if (-not $Apply) {
  Write-Output "Dry-run: $Command"
  Write-Output "Re-run with -Apply to register the task."
  exit 0
}

schtasks /Create /TN $TaskName /SC ONLOGON /TR $Action /F
