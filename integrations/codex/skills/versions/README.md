# Preserved skill versions

`skill-pins.json` and the matching `<id>/<version>/` source and license files are
append-only release inputs. Keep every previously packaged pin when changing a
current skill. Add a new version and snapshot instead of editing an old version.

The current defaults remain in `../skill-sources.json` and `../<id>/`. The build
checks their source, license and provenance declarations against the immutable
pin. Exact old references read only the preserved version; an unavailable or
damaged version is an error and never falls back to the current default.

For third-party skills, preserve the license bytes and pinned repository URL.
Modified skills declare their upstream commit/content hash and `modified: true`.
The upstream hash records the reviewed source; validation verifies the packaged
adaptation and license, and does not fetch or independently re-verify GitHub.

Recovery can recognize a host-recorded pre-update read at its original stable
installed path only when the exact version, complete content and hashes match.
Moving an installation or deleting its history may leave older read evidence
unverified. Never re-run the user's task to manufacture replacement evidence.
