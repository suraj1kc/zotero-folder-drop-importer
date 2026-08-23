# Security Policy

Folder Drop Importer processes local filesystem paths inside Zotero. Plugins have broad local privileges, so security reports are taken seriously.

## Design commitments

- No telemetry.
- No plugin-operated cloud service.
- No background monitoring.
- No automatic source-file deletion or movement.
- No execution of imported files.

## Reporting a vulnerability

Please do not publish an exploitable security issue before maintainers have had a reasonable chance to investigate it. When the repository is public, use GitHub's private vulnerability reporting if enabled; otherwise contact the maintainer through the repository profile.

Include the Zotero version, plugin version, OS, reproduction steps, and impact. Do not include private documents.
