# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 4.x     | ✅ Yes    |
| 3.x     | ❌ No     |
| < 3.0   | ❌ No     |

## Reporting a Vulnerability

**Do not** put security vulnerability details in a public GitHub issue.

GitHub Security Advisories private reporting is not enabled for this repository. Open a [GitHub issue](https://github.com/dichovsky/pdf-to-png-converter/issues/new) and ask the maintainers for a private reporting channel. Do not include vulnerability details in that issue. Send the details only after the maintainers provide a private channel.

Include these items in your report:

- A description of the vulnerability and its possible impact
- Steps to reproduce the issue (proof-of-concept code or a minimal test case)
- The affected versions

**Response time:** The maintainers acknowledge reports within 5 business days and send a status update within 14 business days.

After the maintainers publish a fix in a new release, they publish the security advisory.

## Passwords on the Command Line

The `--pdf-file-password` flag puts the password in the process arguments. Other local users can read the password from a process list. Shell history and audit logs also record the command line.

Use the `PDF_TO_PNG_PASSWORD` environment variable or the library `pdfFilePassword` option instead. The CLI reads `PDF_TO_PNG_PASSWORD` when you omit `--pdf-file-password`. Other local users cannot read environment variables from a process list.

Put quotes around a password that contains spaces. If you do not quote it, the CLI treats the extra words as positional arguments and prints them in the usage error. Load `PDF_TO_PNG_PASSWORD` from a secret store or CI secret. Do not type the variable assignment directly on the command line, because shell history records it.
