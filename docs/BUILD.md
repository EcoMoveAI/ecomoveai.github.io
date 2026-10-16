# Building and installing EcoMove AI on Android and iOS

EcoMove AI uses native modules (background location, TaskManager, SQLite, SecureStore). **Expo Go can run most screens, but background trip detection requires a development or release build.** The recommended path is **EAS Build** (cloud builds, no local Android Studio or Xcode needed).

| Identifier | Value (change before publishing) |
|---|---|
| Android `package` | `com.ecomoveai.app` (`app.json → expo.android.package`) |
| iOS `bundleIdentifier` | `com.ecomoveai.app` (`app.json → expo.ios.bundleIdentifier`) |
| URL scheme | `ecomoveai` |

> Choose identifiers you control (for example `tw.edu.<school>.ecomove`) before the first store upload. They cannot be changed afterwards.

## 0. One-time setup

```bash
npm install
```

```bash
npx eas-cli@latest login
```

```bash
npx eas-cli@latest init
```

`eas init` creates the EAS project and writes `expo.extra.eas.projectId` into `app.json`.

### Public build-time variables

Builds read `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`; the legacy name `EXPO_PUBLIC_SUPABASE_ANON_KEY` is still accepted). Create them once per EAS environment (`development`, `preview`, `production`):

```bash
npx eas-cli@latest env:create --environment development --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR-REF.supabase.co --visibility plaintext
```

```bash
npx eas-cli@latest env:create --environment development --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value YOUR_PUBLISHABLE_KEY --visibility plaintext
```

Repeat for `preview` and `production`. If you skip this, the build runs in on-device mode (no accounts, sync or AI assistant), which is fine for testing tracking and calculations.

## 1. Android

### 1a. Development build (installable APK)

```bash
npx eas-cli@latest build --profile development --platform android
```

When the build finishes, open the link or QR code on the phone, download the APK and install it (allow "Install unknown apps" for your browser). Then start the bundler on your computer:

```bash
npx expo start --dev-client
```

### 1b. Stand-alone test APK (no computer needed)

```bash
npx eas-cli@latest build --profile preview --platform android
```

Share the resulting `.apk` with testers.

### 1c. Android App Bundle for Google Play

```bash
npx eas-cli@latest build --profile production --platform android
```

The output is an `.aab`. Upload the first one manually in Google Play Console (internal testing track). Later uploads can use `npx eas-cli@latest submit --platform android` with a Google service-account key. EAS creates and stores the upload keystore on the first build; back it up with `npx eas-cli@latest credentials`.

**Google Play policy:** apps that request `ACCESS_BACKGROUND_LOCATION` must complete the *Location permissions* declaration in Play Console. This includes a short video showing the in-app disclosure (the Trip detection screen) and explaining why background access is core to the feature. Foreground-service-type location also needs a declaration.

### 1d. Local Android build (optional)

Requirements: JDK 17 and the Android SDK (Android Studio), with `ANDROID_HOME` set.

```bash
npx expo run:android --variant release
```

This generates the `android/` folder via prebuild (do not edit it by hand; configuration lives in `app.json`).

## 2. iOS

### Signing requirements (read first)

* Installing on a **physical iPhone** requires code signing. With EAS, you need a paid **Apple Developer Program** membership (USD 99/year). EAS can create and manage certificates and provisioning profiles for you.
* An iOS app **cannot** be installed on arbitrary iPhones without signing and provisioning. Options:
  * **Internal distribution (ad hoc):** each tester's device UDID must be registered (`npx eas-cli@latest device:create`) before building. Limited to 100 devices per year per device type.
  * **TestFlight:** upload to App Store Connect; testers install the TestFlight app. External testers require Beta App Review.
  * **App Store:** full App Review. Background location must be justified in review notes and visible to the user.
* Without a paid membership, you can still sign with a free "Personal Team" in Xcode on a Mac and run on your own device (`npx expo run:ios --device`). Such builds expire after 7 days.

### 2a. Development build on a device

```bash
npx eas-cli@latest device:create
```

```bash
npx eas-cli@latest build --profile development --platform ios
```

Install via the link or QR code (the device must be registered), enable Developer Mode on iOS 16 and later (Settings → Privacy & Security → Developer Mode), then run:

```bash
npx expo start --dev-client
```

### 2b. iOS Simulator build (no Apple membership needed; Mac required to run it)

```bash
npx eas-cli@latest build --profile development-simulator --platform ios
```

Simulators cannot validate real background-location behaviour.

### 2c. TestFlight / App Store

```bash
npx eas-cli@latest build --profile production --platform ios
```

```bash
npx eas-cli@latest submit --platform ios
```

The app's `Info.plist` gets location usage descriptions and the `location` background mode from the `expo-location` config plugin (`app.json`). `ITSAppUsesNonExemptEncryption` is set to `false` (only standard HTTPS is used).

### 2d. Local iOS build

Requires macOS with Xcode:

```bash
npx expo run:ios --device
```

## 3. What was and was not built in the development environment

The project was developed on Windows 11 without a JDK, Android SDK, macOS/Xcode or an Expo account. Therefore:

* ✅ JavaScript bundles for **both Android and iOS** were produced successfully with `npx expo export --platform android|ios` (Hermes bytecode, about 4 MB each).
* ✅ `expo-doctor` passes all project checks except the one that needs a git repository.
* ❌ No signed APK, AAB or IPA was produced here. That requires running the EAS commands above with your Expo account (and an Apple Developer account for iOS).
* ❌ Background tracking has **not** been validated on physical devices. Follow the device test plan in [TESTING.md](TESTING.md).

## 4. Troubleshooting

| Symptom | Fix |
|---|---|
| "Background tracking needs a development or release build" | You are in Expo Go. Install the development build (1a/2a). |
| Android: background option never appears | Android 11+ opens system settings; choose **Allow all the time**. Check that the build includes `ACCESS_BACKGROUND_LOCATION` (it is in `app.json`). |
| Android: trips missing after a while | Disable battery optimisation for EcoMove (Settings → Apps → EcoMove → Battery → Unrestricted). Some manufacturers (Xiaomi, Huawei, Oppo, Samsung) kill background apps aggressively; see dontkillmyapp.com. |
| iOS: no trips after closing the app | Force-quitting from the app switcher stops background delivery until the app is reopened. Check Settings → EcoMove → Location → **Always**, and Precise Location ON. |
| iOS: "Always" option missing | iOS first grants "While Using". Tap "Allow background detection" in the app; iOS may show the upgrade prompt later. |
| Few points underground (MRT) | Expected: GPS is unavailable underground. Trips may be split or need distance correction; edit the trip. |
| "Accounts are not configured" | `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` were not set for that build environment. |
| Assistant says the AI provider is not configured | Set `GEMINI_API_KEY` as a Supabase function secret and redeploy the `mobility-assistant` function. |
