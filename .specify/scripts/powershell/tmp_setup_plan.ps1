#!/usr/bin/env pwsh
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/common.ps1"
$env:SPECIFY_FEATURE = '005-fix-chat-integration'
$paths = Get-FeaturePathsEnv

$result = [PSCustomObject]@{ 
    FEATURE_SPEC = $paths.FEATURE_SPEC
    IMPL_PLAN = $paths.IMPL_PLAN
    SPECS_DIR = $paths.FEATURE_DIR
    BRANCH = $paths.CURRENT_BRANCH
}
$result | ConvertTo-Json -Compress
