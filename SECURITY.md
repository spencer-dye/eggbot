# Security policy

Please report suspected vulnerabilities through [GitHub's private vulnerability reporting](https://github.com/spencer-dye/eggbot/security/advisories/new), not a public issue. Include the affected package and version, reproduction details, and potential impact without attaching live credentials or private league data.

Security fixes target the latest release. Older versions are not guaranteed to receive backports during the initial framework lifecycle.

EggBot's safety boundaries reduce accidental authority but do not replace deployment controls. Applications must keep OAuth and provider credentials out of decisions and audit payloads, use durable execution journals for writes, preserve the explicit write kill switch, reconcile uncertain outcomes before retrying, restrict persistent files and backups, and provide distributed leases or equivalent coordination before running mutation workflows in multiple replicas.
