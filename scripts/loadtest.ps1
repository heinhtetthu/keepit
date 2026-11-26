param(
    [int[]]$RecordCounts = @(10000, 50000),
    [int[]]$Concurrency = @(1, 10, 25),
    [int]$Requests = 120,
    [switch]$Forecast
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$resultDirectory = Join-Path $repoRoot ('tmp/loadtest/run-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$networkName = 'renewly-load-isolated'
$databaseName = 'renewly-load-db'
$apiName = 'renewly-load-api'
$clientName = 'renewly-load-client'
$reportName = 'renewly-load-reports'

function Invoke-LoadDocker {
    param([string[]]$DockerArguments)
    & docker @DockerArguments
    if ($LASTEXITCODE -ne 0) { throw "Docker $($DockerArguments[0]) failed" }
}

# Refuse to reuse existing resources; cleanup below can only affect this run.
foreach ($containerName in @($databaseName, $apiName, $clientName, $reportName)) {
    $existing = & docker ps -aq --filter "name=^/$containerName$"
    if ($existing) { throw "Container $containerName already exists; stop the prior test first" }
}
$existingNetwork = & docker network ls -q --filter "name=^$networkName$"
if ($existingNetwork) { throw "Network $networkName already exists; remove the prior test network first" }
if ($Requests -lt 1 -or @($Concurrency | Where-Object { $_ -lt 1 -or $_ -gt 25 }).Count) {
    throw 'Use positive request counts and concurrency between 1 and 25'
}
$databasePassword = [guid]::NewGuid().ToString('N')
$sessionKey = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$encryptionKey = [Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes([guid]::NewGuid().ToString('N'))).Replace('+','-').Replace('/','_')
$databaseUrl = "postgresql+asyncpg://postgres:${databasePassword}@${databaseName}:5432/renewly_load"
New-Item -ItemType Directory -Path $resultDirectory -Force | Out-Null
try {
    Invoke-LoadDocker -DockerArguments @('network', 'create', $networkName)
    Invoke-LoadDocker -DockerArguments @('run', '-d', '--rm', '--name', $databaseName, '--network', $networkName,
        '--cpus=1', '--memory=512m', '-e', "POSTGRES_PASSWORD=$databasePassword", '-e', 'POSTGRES_DB=renewly_load', 'postgres:16-alpine')
    # Wait for PostgreSQL before the API's migration command runs.
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        & docker exec $databaseName pg_isready -U postgres *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Synthetic PostgreSQL did not become ready' }
    Invoke-LoadDocker -DockerArguments @('run', '-d', '--rm', '--name', $apiName, '--network', $networkName,
        '--cpus=1', '--memory=1g', '-v', "${repoRoot}/backend/app:/app/app:ro", '-v', "${resultDirectory}:/exports", '-e', "DATABASE_URL=$databaseUrl",
        '-e', "SECRET_KEY=$sessionKey", '-e', "DATA_ENCRYPTION_KEYS=$encryptionKey", 'recordmanagementapp-backend:latest')
    $ready = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        $health = & docker inspect --format '{{.State.Health.Status}}' $apiName
        if ($health -eq 'healthy') { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Synthetic API did not become healthy' }
    Invoke-LoadDocker -DockerArguments @('run', '-d', '--rm', '--name', $reportName, '--network', $networkName,
        '--cpus=1', '--memory=1g', '-v', "${repoRoot}/backend/app:/app/app:ro", '-v', "${resultDirectory}:/exports", '-e', "DATABASE_URL=$databaseUrl",
        '-e', "SECRET_KEY=$sessionKey", '-e', "DATA_ENCRYPTION_KEYS=$encryptionKey", '--entrypoint', 'python',
        'recordmanagementapp-backend:latest', '-c', 'import asyncio; from app.services.report_jobs import report_loop; asyncio.run(report_loop())')
    foreach ($recordCount in ($RecordCounts | Sort-Object -Unique)) {
        $benchmarkArguments = @('run', '--rm', '--name', $clientName, '--network', $networkName,
            '--cpus=1', '--memory=512m', '--user', 'root', '-v', "${repoRoot}/backend:/src:ro",
            '-v', "${resultDirectory}:/results", '-w', '/src', '-e', 'PYTHONPATH=/src', '-e', "DATABASE_URL=$databaseUrl",
            'recordmanagementapp-backend:latest', 'python', 'loadtest/benchmark.py', '--seed', '--records', "$recordCount",
            '--requests', "$Requests", '--output', "/results/records-$recordCount.json", '--concurrency')
        $benchmarkArguments += @($Concurrency | ForEach-Object { "$_" })
        if ($Forecast) { $benchmarkArguments += '--forecast' }
        Invoke-LoadDocker -DockerArguments $benchmarkArguments
    }
    Write-Output "Results: $resultDirectory"
} finally {
    $cleanupPreference = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    foreach ($containerName in @($clientName, $reportName, $apiName, $databaseName)) {
        $containerId = & docker ps -aq --filter "name=^/$containerName$"
        if ($containerId) { & docker stop $containerId *> $null }
    }
    $remainingNetwork = & docker network ls -q --filter "name=^$networkName$"
    if ($remainingNetwork) { & docker network rm $networkName *> $null }
    $ErrorActionPreference = $cleanupPreference
}
