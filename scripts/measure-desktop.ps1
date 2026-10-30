[CmdletBinding(DefaultParameterSetName='Sample')]
param(
    [Parameter(Mandatory, ParameterSetName='Sample')][int]$ProcessId,
    [Parameter(ParameterSetName='Sample')][ValidateRange(5,86400)][int]$DurationSeconds = 900,
    [Parameter(ParameterSetName='Sample')][ValidateRange(1,10)][int]$IntervalSeconds = 2,
    [Parameter(Mandatory, ParameterSetName='Sample')][string]$OutputPath,
    [Parameter(Mandatory, ParameterSetName='SelfTest')][switch]$SelfTest
)
$ErrorActionPreference = 'Stop'

function Select-ProcessTree($Rows, [int]$RootId, [datetime]$RootStarted) {
    $selected = @{}
    $root = @($Rows | Where-Object { $_.Id -eq $RootId -and $_.Started -eq $RootStarted })
    if ($root.Count -ne 1) { throw 'Selected process exited or its PID was reused' }
    $selected[$RootId] = $root[0]
    do {
        $added = $false
        foreach ($row in $Rows) {
            if (!$selected.ContainsKey($row.Id) -and $selected.ContainsKey($row.ParentId) -and $row.Started -ge $selected[$row.ParentId].Started) {
                $selected[$row.Id] = $row
                $added = $true
            }
        }
    } while ($added)
    return @($selected.Values)
}

function Measure-CpuDelta($Current, $Previous, [double]$Elapsed, [int]$LogicalProcessors) {
    if ($Elapsed -le 0 -or $LogicalProcessors -lt 1) { throw 'Invalid CPU measurement interval' }
    $delta = 0.0
    foreach ($row in $Current) {
        $key = "$($row.Id):$($row.Started.Ticks)"
        $before = if ($Previous.ContainsKey($key)) { $Previous[$key] } else { 0.0 }
        $delta += [Math]::Max(0.0, $row.Cpu - $before)
    }
    return 100.0 * $delta / $Elapsed / $LogicalProcessors
}

if ($SelfTest) {
    $started = [datetime]'2026-10-30T12:00:00Z'
    $rows = @(
        [pscustomobject]@{Id=10;ParentId=1;Started=$started;Cpu=4.0},
        [pscustomobject]@{Id=11;ParentId=10;Started=$started.AddSeconds(1);Cpu=2.0},
        [pscustomobject]@{Id=12;ParentId=11;Started=$started.AddSeconds(2);Cpu=1.0},
        [pscustomobject]@{Id=99;ParentId=1;Started=$started;Cpu=500.0}
    )
    $tree = @(Select-ProcessTree $rows 10 $started)
    if ($tree.Count -ne 3 -or 99 -in $tree.Id) { throw 'Process tree isolation failed' }
    $previousCounters = @{}
    $previousCounters["10:$($started.Ticks)"] = 3.0
    $cpu = Measure-CpuDelta $tree $previousCounters 2.0 4
    if ([Math]::Abs($cpu - 50.0) -gt 0.001) { throw 'Normalized CPU arithmetic failed' }
    $rejected = $false
    try { Select-ProcessTree $rows 10 ($started.AddSeconds(-1)) | Out-Null } catch { $rejected = $true }
    if (!$rejected) { throw 'PID reuse was accepted' }
    Write-Output 'PASS isolated descendant tree, normalized CPU deltas, PID reuse rejection'
    exit 0
}

$root = Get-Process -Id $ProcessId
$rootStarted = (Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId").CreationDate
$executable = $root.Path
if (!$executable) { throw 'Could not resolve selected executable' }
$processors = [Environment]::ProcessorCount
$timer = [Diagnostics.Stopwatch]::StartNew()
$samples = [Collections.Generic.List[object]]::new()
$previous = @{}
$previousTime = 0.0
$first = $true
$exitReason = $null

while ($timer.Elapsed.TotalSeconds -le $DurationSeconds) {
    $rows = foreach ($item in Get-CimInstance Win32_Process) {
        [pscustomobject]@{ Id=[int]$item.ProcessId;ParentId=[int]$item.ParentProcessId;Started=$item.CreationDate }
    }
    try { $members = @(Select-ProcessTree $rows $ProcessId $rootStarted) }
    catch { $exitReason = $_.Exception.Message; break }
    $tree = foreach ($member in $members) {
        try {
            $process = Get-Process -Id $member.Id -ErrorAction Stop
            [pscustomobject]@{
                Id=$member.Id;Started=$member.Started;Cpu=$process.TotalProcessorTime.TotalSeconds
                PrivateBytes=$process.PrivateMemorySize64;WorkingSet=$process.WorkingSet64
            }
        } catch { }
    }
    $at = $timer.Elapsed.TotalSeconds
    if (!$first) {
        $samples.Add([pscustomobject]@{
            ElapsedSeconds=[Math]::Round($at,3)
            CpuPercent=[Math]::Round((Measure-CpuDelta $tree $previous ($at-$previousTime) $processors),5)
            PrivateBytes=($tree | Measure-Object PrivateBytes -Sum).Sum
            WorkingSetBytes=($tree | Measure-Object WorkingSet -Sum).Sum
            ProcessCount=$tree.Count
        })
    }
    $previous = @{}
    foreach ($row in $tree) { $previous["$($row.Id):$($row.Started.Ticks)"] = $row.Cpu }
    $first = $false
    $previousTime = $at
    Start-Sleep -Seconds $IntervalSeconds
}
if ($samples.Count -lt 2) { throw 'Insufficient process samples' }
$fullPath = [IO.Path]::GetFullPath($OutputPath)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($fullPath)) | Out-Null
$cpuSorted = @($samples.CpuPercent | Sort-Object)
$firstMemory = [double]$samples[0].PrivateBytes
$summary = [ordered]@{
    CapturedAt=[datetime]::UtcNow.ToString('o');Executable=$executable
    Sha256=(Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
    Os=(Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber)
    Cpu=(Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name)
    RamBytes=(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
    LogicalProcessors=$processors;RequestedSeconds=$DurationSeconds
    MeasuredSeconds=[Math]::Round($samples[-1].ElapsedSeconds-$samples[0].ElapsedSeconds,3)
    Samples=$samples.Count;ExitReason=$exitReason
    AverageCpuPercent=($samples | Measure-Object CpuPercent -Average).Average
    P95CpuPercent=$cpuSorted[[Math]::Min($cpuSorted.Count-1,[Math]::Ceiling($cpuSorted.Count*0.95)-1)]
    FirstPrivateBytes=$samples[0].PrivateBytes;FinalPrivateBytes=$samples[-1].PrivateBytes
    PeakPrivateBytes=($samples | Measure-Object PrivateBytes -Maximum).Maximum
    PrivateGrowthPercent=if($firstMemory -gt 0){100.0*($samples[-1].PrivateBytes-$firstMemory)/$firstMemory}else{$null}
    Caveat='CPU is normalized across logical processors. CPU spent between the last sample and child-process exit is not observable. These measurements alone do not qualify startup, interactions or a mailbox navigation soak.'
}
$summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $fullPath -Encoding utf8
$samples | Export-Csv -LiteralPath ([IO.Path]::ChangeExtension($fullPath,'.csv')) -NoTypeInformation -Encoding utf8
$summary | ConvertTo-Json -Depth 5
