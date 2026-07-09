---
name: "github-release"
description: "Create GitHub prereleases with APK asset upload using a Personal Access Token (PAT) and the GitHub API."
metadata:
  author: "project"
  source: ".agents/skills/github-release/SKILL.md"
---

## User Input

```text
$ARGUMENTS
```

The user provides:
1. **Release version** (e.g., `v0.7.0`, or else read the app.json (or package.json or iota-mobile/android/app/build.gradle) to figureout on your own)
2. **Target tag/branch** (defaults to `main` HEAD)
3. **APK path** — path to the built APK file (default: `iota-mobile/android/app/build/outputs/apk/release/app-release.apk`)

## Prerequisite: PAT from git credentials

```bash
GITHUB_TOKEN=$(echo "url=https://github.com" | git credential fill | sed -n '/^password=/s/^password=//p')
```

The PAT is stored in git credentials and retrieved at runtime. Never hardcode it or commit it.

## Execution Steps

### 1. Compile Release Notes

Read the commit log since the last release tag:

```bash
git log --oneline --format="%h %s" <LAST_TAG>..HEAD
```

Group commits by category (feat/fix/chore) and compose markdown release notes with proper emoji sections.

### 2. Create & Push Tag

```bash
git tag -a <VERSION> -m "Release <VERSION>"
git push origin <VERSION>
```

### 3. Create GitHub Release

```bash
curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/<OWNER>/<REPO>/releases \
  -d "$(python3 -c "
import json, sys
body = sys.stdin.read()
payload = {
    'tag_name': '<VERSION>',
    'name': '<VERSION>',
    'body': body,
    'prerelease': true,
    'draft': false
}
print(json.dumps(payload))
" <<< "$RELEASE_BODY")"
```

Capture the `id` from the response for the next step.

### 4. Upload APK Asset

```bash
curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/vnd.android.package-archive" \
  --data-binary @"<APK_PATH>" \
  "https://uploads.github.com/repos/<OWNER>/<REPO>/releases/<RELEASE_ID>/assets?name=iota-<VERSION>.apk"
```

### 5. Verify

```bash
curl -s -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/<OWNER>/<REPO>/releases/<RELEASE_ID> | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(f\"Tag: {data['tag_name']}\")
print(f\"Prerelease: {data['prerelease']}\")
print(f\"URL: {data['html_url']}\")
print(f\"Assets:\")
for a in data['assets']:
    print(f\"  - {a['name']} ({a['size']} bytes)\")
"
```

## Example (this project)

| Field | Value |
|-------|-------|
| Owner | `sunilbishnoi1` |
| Repo | `IOTA` |
| Default APK path | `iota-mobile/android/app/build/outputs/apk/release/app-release.apk` |
| Release notes prefix | `## What's New in <VERSION>` |

## Important Notes

- The PAT must have `repo` scope (full control of private repositories)
- Do NOT commit or expose the PAT in any file
- Always use `--data-binary` (not `-F`) for APK upload to avoid multipart issues
- The APK asset is renamed from `app-release.apk` to `iota-<VERSION>.apk` during upload
- If the android folder is untracked but present on disk, the APK must be built locally before running this workflow
- This creates a **prerelease** by default (`"prerelease": true`). Set to `false` for full releases.
- If executing this skill on Windows via PowerShell instead of bash, ensure you properly handle string encoding for emojis when constructing the API payload. Default PowerShell string manipulation (like `Invoke-RestMethod` with inline JSON) can corrupt emojis. Workaround: Enforce `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` and build the payload carefully, or use native `curl.exe` with a UTF-8 encoded JSON file.