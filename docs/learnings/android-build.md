# Android/Gradle Build

## Disk Space Exhaustion on C: Drive
- **Root cause:** Gradle home defaults to `C:\Users\<user>\.gradle` which had only 0.02 GB free, causing AAR extraction to fail with "not enough space on the disk".
- **Fix:** Set `$env:GRADLE_USER_HOME="d:\Desktop\codes\IOTA\.gradle_home"` before `.\gradlew assembleRelease` to use the 22 GB free on drive D:.
