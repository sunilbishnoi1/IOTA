# Versioning Guidelines

This document outlines the release versioning strategy for the IOTA application. 

---

## 1. The Strategy: Pre-Release (0.y.z) vs. Stable (x.y.z)

We follow **Semantic Versioning (SemVer 2.0.0)** but adapt it for our current pre-release/prototype phase:

### Phase 1: Pre-Release & Prototyping (`0.y.z`)
*Since the app is not yet deployed to production and is in active testing/prototyping, we use the `0.y.z` prefix.*
* **`0` (Major)**: Represents the pre-production/active development phase. Breaking changes are allowed and expected without bumping the major number.
* **`y` (Minor)**: Incremented for new feature releases, significant UI overhauls, or weekly testing iterations.
* **`z` (Patch)**: Incremented for bug fixes, hotfixes, refactors, or minor tweaks within a test version.

### Phase 2: First Stable Release (`1.0.0`)
* **`1.0.0`**: Marks the first public, production-ready release to the Google Play Store and Apple App Store.

### Phase 3: Production/Post-Release (`x.y.z`)
*Once `1.0.0` is released, we strictly follow standard SemVer:*
* **`x` (Major)**: Incremented for backwards-incompatible changes (e.g., major UI/UX redesigns, database schema migrations requiring manual intervention, or complete structural rewrites).
* **`y` (Minor)**: Incremented for new, backwards-compatible features.
* **`z` (Patch)**: Incremented for backwards-compatible bug fixes and small tweaks.

---

## 2. Resetting from `1.0.x` to `0.y.z`

Since we started at `1.0.1` and are currently at `1.0.4`, we will reset back to a `0.y.z` series for the next release.

### Recommended Version for Next Release: `0.5.0`
Instead of resetting all the way back to `0.1.0`, we recommend resetting to **`0.5.0`**.
* **Why?** We have already compiled and distributed APKs for `1.0.3` and `1.0.4`. Setting the next version to `0.5.0` represents the **5th iteration** of the prototype, avoiding confusion for testers who might mix up a new `0.1.0` with older builds.

---

## 3. Mobile Platform Considerations (Crucial)

App stores (Google Play & Apple App Store) enforce strict rules about version numbers:
1. **User-Visible Version (`version` / `versionName`)**: Can be changed freely (e.g., from `1.0.4` back to `0.5.0`).
2. **Internal Build Identifier (`versionCode` on Android, `buildNumber` on iOS)**: **Must always increase.** If the store sees a lower code, the build will be rejected.

### Expo Configuration (`iota-mobile/app.json`)
To ensure smooth builds and store submissions, configure `app.json` with explicit tracking of build numbers:

```json
{
  "expo": {
    "name": "iota",
    "slug": "iota",
    "version": "0.5.0",
    "android": {
      "package": "com.iota.app",
      "versionCode": 5
    },
    "ios": {
      "bundleIdentifier": "com.iota.app",
      "buildNumber": "5"
    }
  }
}
```

* **Rule**: Whenever you bump the user-visible version string (e.g., `0.5.0` -> `0.5.1` or `0.6.0`), you **must** also increment the `versionCode` (Android) and `buildNumber` (iOS) by `1` (e.g., `5` -> `6`).

---

## 4. How to Increment (Workflow Checklist)

To avoid thinking too much about versioning in the future, follow this quick decision tree before building a new version:

| Scenario | Version Type | Example Change | New Version |
| :--- | :--- | :--- | :--- |
| Bug fixes, minor adjustments, styling tweaks | **Patch** (`z`) | Fix typo, adjust margins, update lockfile | `0.5.0` $\rightarrow$ `0.5.1` |
| New screens, new tools, workspace features | **Minor** (`y`) | Added QR code rendering, integrated bridge support | `0.5.0` $\rightarrow$ `0.6.0` |
| First public App Store/Google Play launch | **Major** (`x` $\rightarrow$ 1) | App goes live to public users | `0.12.3` $\rightarrow$ `1.0.0` |

### Automation Tip
You can run the following standard commands in the root of the workspace to bump versions in `package.json` automatically:
* `npm version patch` (bumps `x.y.z` to `x.y.z+1`)
* `npm version minor` (bumps `x.y.z` to `x.y.z+1.0`)

*Note: Make sure to manually align `iota-mobile/package.json` and `iota-mobile/app.json` versions.*
