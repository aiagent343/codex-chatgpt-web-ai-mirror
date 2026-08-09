$ErrorActionPreference = "Stop"

$root = (git rev-parse --show-toplevel).Trim()

if ([string]::IsNullOrWhiteSpace($root)) {
    Write-Host "SECRET SCAN: repository root not found." -ForegroundColor Red
    exit 1
}

function Get-Fingerprint {
    param([string]$Value)

    $sha = [Security.Cryptography.SHA256]::Create()

    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
        $hash = $sha.ComputeHash($bytes)

        return (
            [BitConverter]::ToString($hash)
        ).Replace("-", "").Substring(0,16)
    }
    finally {
        $sha.Dispose()
    }
}

function Get-Entropy {
    param([string]$Value)

    if ([string]::IsNullOrEmpty($Value)) {
        return 0.0
    }

    $entropy = 0.0

    foreach ($group in ($Value.ToCharArray() | Group-Object)) {
        $p = $group.Count / $Value.Length
        $entropy -= $p * [Math]::Log($p, 2)
    }

    return $entropy
}

# Synthetic fixtures manually reviewed for this codebase.
# Only the fingerprint is allowed; changing the fixture triggers review.
$knownFixtures = @(
    "93917ED0FACC66E1",
    "A6BB986B9BE18ADE",
    "71685CFC4C00B124",
    "C14C42BD8A67E4B2",
    "B4D0AA4252546762",
    "47E6226195D17789",
    "2BFEC5B73FFC82CB"
)

$staged = @(
    git diff --cached --name-only --diff-filter=ACMR
)

if ($LASTEXITCODE -ne 0) {
    Write-Host "SECRET SCAN: unable to list staged files." -ForegroundColor Red
    exit 1
}

$blocked =
    New-Object System.Collections.Generic.List[string]

foreach ($relative in $staged) {

    if ([string]::IsNullOrWhiteSpace($relative)) {
        continue
    }

    $pathLower =
        $relative.Replace("\","/").ToLowerInvariant()

    # ---------------------------------------------------------
    # Forbidden paths
    # ---------------------------------------------------------

    if (
        $pathLower -match '(^|/)auth\.json$' -or
        $pathLower -match '(^|/)(credentials|secrets)\.json$' -or
        $pathLower -match '\.(sqlite|sqlite3|db|db-wal|db-shm)$' -or
        $pathLower -match '\.(pem|pfx|p12|key)$' -or
        $pathLower -match '(^|/)browser-profile/' -or
        $pathLower -match '(^|/)user-data-dir/' -or
        $pathLower -match '(^|/)native-relay-diagnostic/' -or
        $pathLower -match '(^|/)diagnostics/raw/' -or
        $pathLower -match '(^|/)diagnostics/browser-turns/'
    ) {
        $blocked.Add(
            "$relative :: forbidden sensitive path"
        )

        continue
    }

    # ---------------------------------------------------------
    # Only inspect likely text files for literal secrets
    # ---------------------------------------------------------

    $isText =
        (
            $pathLower -match
            '\.(ts|tsx|js|jsx|cjs|mjs|json|md|txt|yml|yaml|toml|ini|cfg|conf|ps1|psm1|sh|bat|cmd|html|css|xml)$'
        ) -or
        (
            [IO.Path]::GetFileName($pathLower) -in @(
                ".gitignore",
                ".gitattributes"
            )
        )

    if (!$isText) {
        continue
    }

    $savedEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    $content =
        (
            git show ":$relative" 2>$null
        ) -join "`n"

    $showExit =
        $LASTEXITCODE

    $ErrorActionPreference = $savedEap

    if ($showExit -ne 0) {
        $blocked.Add(
            "$relative :: unable to inspect staged content"
        )

        continue
    }

    # ---------------------------------------------------------
    # Strong credential formats
    # ---------------------------------------------------------

    $strongPatterns = @(
        @{
            Name = "GitHub PAT"
            Regex = '(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})'
        },
        @{
            Name = "OpenAI API key"
            Regex = 'sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}'
        },
        @{
            Name = "AWS access key"
            Regex = '(AKIA|ASIA)[A-Z0-9]{16}'
        },
        @{
            Name = "Google API key"
            Regex = 'AIza[0-9A-Za-z_-]{30,}'
        },
        @{
            Name = "Private key"
            Regex = '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
        },
        @{
            Name = "JWT"
            Regex = 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
        }
    )

    foreach ($pattern in $strongPatterns) {

        foreach (
            $match in
            [regex]::Matches(
                $content,
                $pattern.Regex
            )
        ) {
            $value =
                $match.Value

            $fp =
                Get-Fingerprint $value

            if ($knownFixtures -contains $fp) {
                continue
            }

            $blocked.Add(
                "$relative :: $($pattern.Name) :: fingerprint=$fp"
            )
        }
    }

    # ---------------------------------------------------------
    # Long literal Bearer tokens
    # ---------------------------------------------------------

    foreach (
        $match in
        [regex]::Matches(
            $content,
            'Bearer\s+([A-Za-z0-9_\-\.~+/=]{32,})'
        )
    ) {
        $value =
            $match.Groups[1].Value

        $fp =
            Get-Fingerprint $value

        if ($knownFixtures -contains $fp) {
            continue
        }

        $entropy =
            Get-Entropy $value

        if ($entropy -ge 3.5) {
            $blocked.Add(
                "$relative :: high-entropy Bearer literal :: fingerprint=$fp"
            )
        }
    }

    # ---------------------------------------------------------
    # Hard-coded credential assignments.
    # Dynamic GitHub Actions expressions do not match this.
    # ---------------------------------------------------------

    $assignmentPattern =
        '(?im)\b(OPENAI_API_KEY|GITHUB_TOKEN|GH_TOKEN|API_KEY|ACCESS_TOKEN)\b\s*[:=]\s*["'']([A-Za-z0-9_\-\.~+/=]{20,})["'']'

    foreach (
        $match in
        [regex]::Matches(
            $content,
            $assignmentPattern
        )
    ) {
        $value =
            $match.Groups[2].Value

        $fp =
            Get-Fingerprint $value

        if ($knownFixtures -contains $fp) {
            continue
        }

        $blocked.Add(
            "$relative :: hard-coded credential :: fingerprint=$fp"
        )
    }
}

$blocked =
    @(
        $blocked |
        Sort-Object -Unique
    )

if ($blocked.Count -gt 0) {

    Write-Host ""
    Write-Host "====================================================" -ForegroundColor Red
    Write-Host "PRE-COMMIT SECRET SCAN = BLOCKED" -ForegroundColor Red
    Write-Host "===================================================="

    foreach ($item in $blocked) {
        Write-Host $item -ForegroundColor Red
    }

    Write-Host ""
    Write-Host "Secret values were not printed." -ForegroundColor Yellow

    exit 1
}

Write-Host "PRE-COMMIT SECRET SCAN = PASS" -ForegroundColor Green
exit 0