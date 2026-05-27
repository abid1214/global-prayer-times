# iOS release setup (no Mac required)

End state: you push a tag like `v1.0.0`, GitHub Actions rents a Mac, builds & signs the iOS app, and uploads it to TestFlight. You submit for App Store review from the App Store Connect website.

These one-time setup steps all work from Linux / Windows. The only Mac involved is the ephemeral macOS GitHub Actions runner.

## 1. Enroll in the Apple Developer Program

- https://developer.apple.com/programs/enroll/ — $99/yr. Individual is fine; you can convert to an organization later.
- Find your **Team ID** at https://developer.apple.com/account → Membership Details. Looks like `A1B2C3D4E5`. Save it — you'll add it as a GitHub secret in step 6.

## 2. Create the app entry in App Store Connect

- https://appstoreconnect.apple.com/ → My Apps → "+" → New App.
- **Bundle ID**: `com.abidkhan.globalprayertimes` (must match `appId` in `capacitor.config.json`). If you want a different one, change it in the config first.
- **SKU**: anything unique to your account, e.g. `gpt-001`.
- Leave the metadata blank for now — you'll fill it in before submitting for review.

## 3. Create an App Store Connect API key

This is what lets CI authenticate without your Apple ID password or 2FA codes.

- https://appstoreconnect.apple.com/access/api → Keys tab → "+".
- **Access**: App Manager.
- Download the `.p8` file. **You cannot re-download it** — back it up.
- Note the **Key ID** (10-char string above the download button) and **Issuer ID** (UUID at the top of the page).

## 4. Create a private repo for signing certificates

Fastlane match stores your distribution certificate + provisioning profile encrypted in a git repo so CI can pull them down.

- Create a **private** GitHub repo. Suggested name: `global-prayer-times-certs`. Leave it empty (no README).
- Generate a **fine-grained personal access token** scoped to just that repo, with Contents: Read and Write.
  - https://github.com/settings/personal-access-tokens/new → "Only select repositories" → pick the certs repo.

## 5. Seed the certs repo (one-time, from your Linux/Windows machine)

You'll run fastlane match locally to generate the certificate + provisioning profile and push them into the certs repo. Match doesn't need a Mac — the cert generation is OpenSSL + Apple Developer API calls, both cross-platform.

```sh
# Install Ruby 3.2 and bundler if you don't have them. On Ubuntu:
sudo apt install -y ruby-full
gem install bundler

# From the global-prayer-times repo root:
cd fastlane
bundle install

# Pick a strong passphrase for the cert encryption. Save it — you'll add
# it as a GitHub secret in step 6 as MATCH_PASSWORD.
export MATCH_PASSWORD='your-strong-passphrase'

# Auth to the certs repo. Substitute your GitHub username + the token
# from step 4.
export MATCH_GIT_URL='https://github.com/abid1214/global-prayer-times-certs.git'
export MATCH_GIT_BASIC_AUTHORIZATION="$(printf '%s' 'abid1214:ghp_yourTokenHere' | base64)"

# Auth to Apple. The .p8 from step 3.
export APP_STORE_CONNECT_API_KEY_ID='ABC1234567'
export APP_STORE_CONNECT_API_KEY_ISSUER_ID='12345678-1234-1234-1234-123456789abc'
export APP_STORE_CONNECT_API_KEY_CONTENT="$(base64 -w0 < ~/Downloads/AuthKey_ABC1234567.p8)"

export DEVELOPER_TEAM_ID='A1B2C3D4E5'
export APP_IDENTIFIER='com.abidkhan.globalprayertimes'

# This creates the cert + profile, registers the bundle ID with Apple if
# it doesn't exist yet, and pushes encrypted copies to the certs repo.
bundle exec fastlane match appstore --readonly false
```

If `match appstore` succeeds, browse to the certs repo on GitHub — you should see `certs/` and `profiles/` directories with encrypted files.

## 6. Add GitHub repo secrets

In this repo's GitHub settings → Secrets and variables → Actions → New repository secret. Add each of these:

| Secret name | Value |
| --- | --- |
| `DEVELOPER_TEAM_ID` | from step 1 (e.g. `A1B2C3D4E5`) |
| `APP_STORE_CONNECT_API_KEY_ID` | from step 3 |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | from step 3 |
| `APP_STORE_CONNECT_API_KEY_CONTENT` | base64 of the `.p8` (the value of `$APP_STORE_CONNECT_API_KEY_CONTENT` above) |
| `MATCH_PASSWORD` | the passphrase from step 5 |
| `MATCH_GIT_URL` | HTTPS URL of the certs repo |
| `MATCH_GIT_BASIC_AUTHORIZATION` | base64 of `username:token` (the value of `$MATCH_GIT_BASIC_AUTHORIZATION` above) |

## 7. Cut a release

```sh
git tag v1.0.0
git push origin v1.0.0
```

Watch the build at https://github.com/abid1214/global-prayer-times/actions. ~10–15 minutes on a macos-14 runner. When it finishes, the build appears in App Store Connect → TestFlight within a few minutes (Apple processes it server-side).

You can also trigger a build without a tag: Actions tab → "iOS Release (TestFlight)" → "Run workflow" → enter a version like `1.0.1`.

## 8. Submit for App Store review

From the App Store Connect website (no Mac needed):

1. App Store Connect → your app → App Store tab.
2. Fill in: app description, keywords, support URL, privacy policy URL, age rating, screenshots (6.7" + 6.5" iPhone sizes — see [Apple's specs](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/)).
3. Select the TestFlight build you uploaded.
4. Under **App Privacy**: declare network usage for OpenStreetMap geocoding (`nominatim.openstreetmap.org`). No other data is collected.
5. Under **App Review Information**: in the notes field, pre-empt the Apple Guideline 4.2 "minimum functionality" objection by mentioning the on-device GLSL prayer-window shader and offline support. Something like:

   > This is a native iOS app (Capacitor) that performs real-time astronomical computation on-device via a custom GLSL fragment shader to classify prayer windows worldwide. It works offline after first launch (geocoded city search is the only online feature). Not a website wrapper.

6. Submit for review. First review typically takes 24–48 hours. Subsequent updates often within a few hours.

## How to get screenshots without a Mac

Since the app is a webview, you can take "production-quality" screenshots straight from a desktop browser:

1. Open the [live site](https://abid1214.github.io/global-prayer-times/) on your laptop.
2. Open dev tools → device toolbar → choose **iPhone 15 Pro Max** (6.7", 1290×2796) and **iPhone 8 Plus** (6.5", 1242×2208).
3. Screenshot. Crop browser chrome.
4. Apple accepts PNG or JPEG at the exact pixel dimensions above.

Or use [PWABuilder's screenshot tool](https://www.pwabuilder.com/) which generates store-ready screenshots from a URL.

## Things that can go wrong on first run

- **`fastlane match` says "Could not create distribution certificate"** — the team only allows 2 active distribution certs at a time. Run `fastlane match nuke distribution` first if you have an old one.
- **`upload_to_testflight` fails with "Invalid binary"** — usually a missing `Info.plist` privacy string. Capacitor's template includes the common ones; you'd only hit this if you add new native plugins.
- **`cap add ios` fails with "pod: command not found"** — the macos-14 runner ships with CocoaPods, but if you change runners, `brew install cocoapods` in a step.
- **Build succeeds but TestFlight rejects with "missing compliance"** — go to App Store Connect → TestFlight → tap the build → answer the encryption export compliance question (this app uses only standard HTTPS, answer "Yes" then "Exempt").
