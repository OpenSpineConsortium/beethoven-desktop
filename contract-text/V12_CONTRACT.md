# Beethoven 12.0.0 and framework 11: the contract

The canonical copy of this contract lives in `OpenSpineConsortium/hpcworker`
(`docs/V12_CONTRACT.md`); this copy and that one change together, in the same words.

2026-10-02. What the extension, the helper and the grid tool agree on for the direct way (ssh to the
login node with no VPN). The Open OnDemand path is 11.0.0's and is unchanged: `docs/V11_CONTRACT.md`.
Section names here are the ones the code cites (`extension/src/core/*.ts`). Versions: extension
12.0.0, framework 11 (`framework/VERSION`), helper 1.0.0 speaking protocol 1, `LICENSE.txt` version 9,
`PRIVACY.md` version 10, `TERMS_VERSION` 9 dated 2026-10-02.

## Facts

What the grid answered from the internet on 2026-10-01 and 2026-10-02 (no sign-in was ever made):

- `grid.wayne.edu:22`, OpenSSH 7.4. Host key `ssh-rsa`, fingerprint
  `SHA256:kLTz1xK6anQ1denM+31kDEryQtgan2P76r9aLno+K3s` (pinned: no trust on first use; any other key
  stops the connection before anything about the student is sent). Ciphers `aes128-ctr`,
  `aes192-ctr`, `aes256-ctr`; MAC `hmac-sha1`; key exchange includes `curve25519-sha256` and
  `ecdh-sha2-nistp256`. Methods `publickey`, `password`, `keyboard-interactive`. No `sk-` key types.
- A password sign-in also asks for the Google Authenticator code (pam_google_authenticator: "Your
  google authenticator one-time verification code: "). An account without one is refused with "You
  either typed in the wrong code, or you do not have Google Authenticator 2FA setup. Please try again,
  or login to OnDemand and run the 2FA Setup app." The text names both causes, so it never proves the
  account has no code. The code is enrolled only in OnDemand's 2FA Setup app, on the VPN, and running
  that app destroys any existing code.
- The site profile carries these as `ssh_host`, `ssh_port`, `ssh_host_key`, `ssh_relay` (null) and
  `grid_2fa_help_url` (KB 20242); `framework/profiles/wayne.json`.
- warrior's banner bans python, python3, node, md5sum, rsync and others "on sight": nothing on the
  direct way runs them on the login node (framework README, "The login node").

## Bridges

A browser extension has no socket. The ssh client (`extension/src/ssh/`, WebCrypto only) is handed a
byte stream to `grid.wayne.edu:22` by the first bridge this browser has, in this order (decision D3):

1. **store**: a browser-only bridge another extension offers. None exists: Chromium lets only Google's
   Secure Shell open sockets, and it offers other extensions no byte stream (exploration A). A stub
   that answers "not available".
2. **relay**: a WebSocket to a relay the site profile names in `ssh_relay`. Wayne State names none,
   so it answers "not configured" and no ticket is ever asked for.
3. **helper**: the native messaging host `com.openspineconsortium.beethoven.bridge`, which ships
   inside the extension (`extension/public/bridge/`, built from `helper/`) and is installed once by
   the student without administrator rights. What the host is depends on the system. On Windows and
   macOS, from 15.0.0, the store item offers the binary edition (`helper/src/rust`: one program, the
   Rust standard library and nothing else; `"kind":"binary"`, `"runtime":"rust"`) in a signed
   installer (section "Signed installers (15.0.0)"). On Linux, and on every system for a build the
   signed installers do not name, it is the script edition in a zip: Windows PowerShell 5.1 on
   Windows (`"runtime":"powershell"`), `/usr/bin/perl` on macOS (`"perl"`), perl or else python3 on
   Linux (`"perl"` or `"python"`); all `"kind":"script"`.

If none is available, Beethoven offers the helper once and, under it, **Use GlobalProtect instead**:
the 11.0.0 path. None of the bridges sees inside the ssh session.

## The helper's wire contract

Chrome's native messaging: UTF-8 JSON, each message framed by a 4-byte little-endian length; host to
browser at most 1 MiB (Chrome's cap, observed exact); data payloads at most 64 KiB of base64.

| Direction | Message |
|---|---|
| extension to helper | `{"t":"hello","v":1}` |
| | `{"t":"open","id":"<id>","host":"grid.wayne.edu","port":22}` |
| | `{"t":"data","id":"<id>","b64":"<base64>"}` |
| | `{"t":"close","id":"<id>"}` |
| helper to extension | `{"t":"hello","v":1,"helper":"1.0.0","os":"windows\|mac\|linux","kind":"script\|binary","allow":["grid.wayne.edu:22"],"runtime":"powershell\|perl\|python\|rust"}` |
| | `{"t":"opened","id":"<id>"}` |
| | `{"t":"data","id":"<id>","b64":"..."}` |
| | `{"t":"closed","id":"<id>","reason":"eof\|reset\|local"}` |
| | `{"t":"error","id":"<id or empty>","reason":"<short>"}` (`not_allowed`, `dns`, `refused`, `timeout`, `unknown_id`, `too_large`, ...) |

The helper opens TCP only to an entry of its built-in allowlist (`grid.wayne.edu:22`) or of an
`allow.txt` beside it that its installer copied (at most 8 entries; the shipped zips carry none),
carries bytes both ways, never logs a payload, holds no credential, has no shell, and exits when
Chrome closes its standard input. A connection that never opened ends with one `error`; one that
opened ends with one `closed`. Connect timeout 30 s, name lookup included. Reading from Chrome pauses
above 8 MiB queued for the network and resumes below 2 MiB. Chrome's "Specified native messaging
host not found." means not installed; any other Chrome error means broken.

**Allowed origins.** Chrome starts the host only for the extensions its manifest names. The zips in
the package carry a placeholder their installers refuse; the extension page that offers the download
writes the extension's own `chrome-extension://<id>/` into a copy of the zip in memory
(`core/bridgeZip.ts`) and saves that copy, so the store, Edge or a development build each get a
helper made out to themselves. Where the copy cannot be made, the packaged zip is saved unchanged
and its installer refuses with its own sentence. The signed installers are never rewritten: they
name the store item only, from the moment they are built (next section).

## Signed installers (15.0.0)

From 15.0.0 the package's `bridge/` holds two signed installers beside the three script zips, which
stay as they were. They are built only on the maintainer's own machines (`helper/release/mac/`,
`helper/release/windows/`), with the store item's identifier given as `--store-id <32 letters a-p>`
and written into the installer as its `allowed_origins`, `["chrome-extension://<id>/"]`.

- `beethoven-bridge-mac.pkg`: a universal binary (aarch64 and x86_64 joined with `lipo`), codesigned
  with a Developer ID Application identity, the hardened runtime and a timestamp; the package signed
  with a Developer ID Installer identity, notarized and stapled. It installs into the current user's
  home only
  (`<domains enable_anywhere="false" enable_currentUserHome="true" enable_localSystem="false"/>`),
  so no administrator password is asked. Payload, relative to the home:
  `Library/Application Support/Beethoven/bridge/` with `beethoven-bridge`, `uninstall.command`,
  `README.txt` and `allowed_origins.json` (a JSON array of one origin, as in the zips). Its
  postinstall writes `com.openspineconsortium.beethoven.bridge.json` into
  `Library/Application Support/Google/Chrome/NativeMessagingHosts/` always, and into the Microsoft
  Edge and Chromium folders only when they exist, with `name`, `description`, an absolute `path` to
  `beethoven-bridge` under the home, `"type":"stdio"` and `allowed_origins` read from
  `allowed_origins.json` (refusing anything that does not match the origin pattern). It deletes
  nothing.
- `beethoven-bridge-windows.msi`: x64, `Scope="perUser"`, no administrator; built on the Mac
  (`x86_64-pc-windows-gnu`, msitools' `wixl` from `bridge.wxs`) or, as the fallback, on a Windows
  machine (`x86_64-pc-windows-msvc`, WiX v5 from `Package.wxs`), with the same files and registry
  values either way. The exe and then the MSI are Authenticode-signed through Azure Artifact
  Signing (SHA-256 digests, timestamped). Files in `%LOCALAPPDATA%\Beethoven\bridge\`:
  `beethoven-bridge.exe`, `com.openspineconsortium.beethoven.bridge.json` (its `path` is the
  relative `beethoven-bridge.exe`, which Chrome resolves beside the manifest on Windows) and
  `README.txt`; the default value of
  `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.openspineconsortium.beethoven.bridge` and of
  `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.openspineconsortium.beethoven.bridge` is
  that manifest's full path. Removed from Settings, Apps, "Beethoven bridge", Uninstall.

`bridge/manifest.json` lists each signed installer as one entry, with no `open` (the file itself is
the installer):

```
{"os":"mac","kind":"binary","name":"beethoven-bridge-mac.pkg","size":<bytes>,"sha256":"<64 lower-case hex>","allowed_origins":["chrome-extension://<id>/"],"signed":"developer-id-notarized"}
{"os":"windows","kind":"binary","name":"beethoven-bridge-windows.msi","size":<bytes>,"sha256":"<64 lower-case hex>","allowed_origins":["chrome-extension://<id>/"],"signed":"authenticode"}
```

The script entries are unchanged (`"kind":"script"`, an `open`, no `signed`). The signed installers
are offered as they are and never rewritten at download time: the identifier is in them from the
build, and a rewrite would break the signature. **The picker's rule:** a signed entry for this
system is offered in place of the system's script zip only when its `allowed_origins` contains
`chrome-extension://<chrome.runtime.id>/`; otherwise it is never offered, so a development build, or
any copy that is not the store item, gets the script zip as before. Linux has no signed entry.

`node helper/build.mjs` takes each package from `helper/signed/` (gitignored) with its sidecar
`<name>.json`,
`{"name","os","kind":"binary","helper","protocol":1,"size","sha256","allowed_origins","signed","built_at","tools"}`,
and refuses (exit 1, naming the sidecar and the reason) one whose `helper` differs from
`helper/VERSION`, whose `protocol` is not 1, whose size or SHA-256 differ from the file's, whose
name does not match `^[A-Za-z0-9._-]+$` or does not end in `.pkg` for `mac` or `.msi` for `windows`,
whose origins are empty or do not each match `^chrome-extension://[a-p]{32}/$` (or, with
`--store-id`, are not exactly that one), or whose `signed` is not `developer-id-notarized` or
`authenticode`. `--no-signed` ignores `helper/signed/`; without that folder the build is
byte-identical to 14.0.0's. Nothing in this section has been built, signed or opened on a real Mac
or Windows machine: not yet measured.

## The sign-in sheet

An extension page. The student types the AccessID. The background opens a connection through the
bridge, checks the host key against the pin, and asks for `keyboard-interactive`; each prompt the grid
sends is shown as the grid wrote it, one at a time (at Wayne State the password, then the code). An
answer is held only until its request is sent, inside the encrypted session, then dropped: never
stored, logged or offered to be remembered (R2). This computer's key is made or opened before the grid
is asked for anything.

- A refusal is the grid's own and the grid asks again; after three in a row Beethoven stops, offers
  GlobalProtect, and refuses a new sign-in for that AccessID for 15 minutes (`COOLDOWN_MS`; the count
  is kept in `storage.session`).
- The 2FA refusal text above is answered with "The grid didn't accept the code": type it again, or "I
  don't have a grid code yet", and only then the route choice (on this computer, or with a phone),
  each carrying the 2FA Setup warning.
- Once the grid accepts, in that same session (with a pseudo-terminal, as 11.0.0's portal terminal
  had), Beethoven runs:

  ```
  bash '<shared>/bin/hpcworker' browser-key add <ssh-ed25519|ecdsa-sha2-nistp256> <base64> beethoven-browser
  bash '<shared>/bin/hpcworker' install --shared '<shared>' --profile '<site>'
  ```

  and then a second connection, signed in with the key, runs the gate's `version`; the key is enrolled
  only when that names the same account. The approval check goes to the access service only after the
  grid accepted the sign-in, with no new field (R4).
- The signed-in session is then held, in memory, for up to 10 minutes (`HOLD_MS`), so the first
  Connect can run the Claude sign-in in it:

  ```
  exec bash '<shared>/bin/hpcworker' connect --name '<name>' --profile '<site>' [--consent '<id>'] --login 'auto' --permission-mode '<mode>' [--no-chain]
  ```

  with a pseudo-terminal, the pasted Claude code written to its standard input followed by `\r`. Its
  `HPCW-STEP` lines are 11.0.0's (`V11_CONTRACT.md`). Every later Claude sign-in shows the sheet again:
  the gate's connect is always `--login never`.

`browser-key add` answers exactly one line: `HPCW-KEY added SHA256:<43 characters>` (exit 0; the same
line when the key was already there), or `HPCW-KEY refused <code> <sentence>` with code `key`, `agent`,
`root`, `usage` (exit 2), `home` (3), `ssh-dir` (4), `authorized-keys` (7) or `copy` (8: the lab's copy,
or a folder above it, can be changed by others than its owner; the sentence names it). A lab copy older
than framework 11 answers `hpcworker: unknown command 'browser-key' (hpcworker help)` on standard
error with exit 1.

## The key

By default no biometric step (D2). An Ed25519 key pair where the browser's WebCrypto has it, else ECDSA
P-256. Its private half is stored wrapped (AES-256-GCM) under a non-extractable browser key that lives
beside it in IndexedDB (`beethoven-key`); the key that signs is always unwrapped non-extractable, in
memory. **Opt-in**, never by default: "Protect my key with Windows Hello / Touch ID" wraps the same key
instead under a key derived from a passkey's PRF output (HKDF-SHA-256), and deletes the browser key;
the key then opens once per browser session, the passkey's output kept in `storage.session`. On and
off move the same key between wraps, so nothing changes on the grid. Turned on after the key was made,
it does not reach copies of the browser's files made before the browser tidies its database (the old
record was seen in IndexedDB's log after an overwrite and a delete); the sign-in sheet's tick, before
the key exists, has no such gap.

The grid holds one line per account (a newer key replaces an older one):

```
restrict,command="<shared_install>/bin/hpcworker gate" <ssh-ed25519|ecdsa-sha2-nistp256> <base64> beethoven-browser <YYYY-MM-DD UTC>
```

`<shared_install>` is the site profile's `current` link. `browser-key add` writes it only when the
copy and every folder from `/` down to it can be changed by their owner alone or are sticky; the file
it replaced is kept as `~/.ssh/authorized_keys.beethoven-prev` without any Beethoven line. **Forget this
computer** sends the gate's `forget`, then deletes the key (a protected key is unlocked first, so the
grid is told). Withdrawing an approval does not remove the line.

## The gate

`hpcworker gate` is the line's forced command; it reads `SSH_ORIGINAL_COMMAND`. Accepted, exactly:

| The client sends | The gate prints |
|---|---|
| `version` | `HPCW-GATE ok <framework> <due\|never\|-> <account> claude=<yes\|no\|unknown>` |
| `status NAME` | one JSON line, `worker status --json` (`{"v":1,...}`) |
| `watch NAME` | JSON lines `{"v":1,"event":"status","final":<bool>,...}` per change and `{"v":1,"event":"keepalive","at":"<UTC>"}` every 20 s; exit 0 online, 1 stopped or error or ended, 2 out of time (30 minutes) |
| `connect NAME SITE <32 hex\|-> <default\|acceptEdits\|plan> <chain\|no-chain>` | the `HPCW-STEP` lines, never `signin` (always `--login never`) |
| `stop NAME` | `worker NAME: stopped (...)` |
| `restrict NAME` | `worker NAME: marked restricted (...)` |
| `read NAME FILE`, FILE one of `status.json`, `connection.json`, `progress.log`, `node` | the file's bytes (`progress.log`'s last 256 KB); exit 1 `HPCW-GATE missing`, 3 `not-plain` or `too-large`, on standard error. `rc.log` and every other file: refused |
| `forget` | `HPCW-KEY forgotten`, `none`, or `stuck` (exit 7) |

Anything else: `HPCW-GATE refused`, exit 126. Past `browser_key_days` (none at Wayne State): the line
is removed and `HPCW-KEY expired`, exit 125. Caps, per account, in `<shared_state_dir>/.gate/caps`: 3
worker names, each counting for 7 days after its last use and all cleared by `browser-key add`; 12
connects (and restricts of a name with no run) in any hour; 2 watches at once, taken only for a run
that exists. Past one: `HPCW-GATE limit names|hourly|watch|busy`, exit 123, nothing run.

Read the gate's lines by their prefix (`HPCW-` or `{"v":1`): sshd runs the forced command through the
account's shell, and a `~/.bashrc` that prints something prints it first. Read a worker's state with
`status` (which carries the status and connection files inside its one JSON line), and use `read` for
`progress.log` and `node` as text.

## Storage

The extension's keys for the direct way (`extension/src/core/keys.ts`), each named in `PRIVACY.md`
version 10: `bridge.direct` (local: the account the grid accepted and when, the key's fingerprint and
when it was added, the student's choices on the direct way's one-time screens), `bridge.bridges`
(session: what the last probe of the bridges found), `bridge.keyUnlock` (session, only while the key is
protected and unlocked: the passkey's output), `bridge.route` (session: the code-setup route chosen),
`bridge.refusals` (session: per AccessID, refusals in a row and when the last was), and the IndexedDB
database `beethoven-key` (the wrapped key). Audit endpoints: `ssh://grid.wayne.edu/gate/<verb>` and
`ssh://grid.wayne.edu/session/<verb>` (`browser-key-add`, `install`, `connect`).
