#!/usr/bin/env pwsh
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$env:SPECIFY_FEATURE = '005-fix-chat-integration'
. "$PSScriptRoot/setup-plan.ps1" -Json
