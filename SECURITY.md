# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 4.x     | ✅ Yes    |
| 3.x     | ❌ No     |
| < 3.0   | ❌ No     |

## Reporting a Vulnerability

**Do not** put security vulnerability details in a public GitHub issue.

GitHub Security Advisories private reporting is not enabled for this repository. Open a [GitHub issue](https://github.com/dichovsky/pdf-to-png-converter/issues/new). Ask the maintainers for a private reporting channel. Do not include vulnerability details in that issue. Send the details only after the maintainers give you a private channel.

Include these items in your report:

- A description of the vulnerability and its possible impact
- Steps to reproduce the issue (proof-of-concept code or a minimal test case)
- The affected versions

**Response time:** The maintainers acknowledge reports in 5 business days or less. They send a status update in 14 business days or less.

After the maintainers publish a fix in a new release, they publish the security advisory.

## Passwords on the Command Line

The `--pdf-file-password` flag puts the password in the process arguments. Other local users can read the password from a process list. Shell history and audit logs also record the command line.

Do not use `--pdf-file-password`. Use the `PDF_TO_PNG_PASSWORD` environment variable or the library `pdfFilePassword` option. The CLI reads `PDF_TO_PNG_PASSWORD` when you do not give `--pdf-file-password`. Access to the process environment depends on the operating system and the permissions of the observer.

Put quotes around a password that contains spaces. If you do not put quotes around it, the CLI reads the remaining words as positional arguments and prints them in the usage error. Load `PDF_TO_PNG_PASSWORD` from a secret store or CI secret. Do not type the variable assignment directly on the command line, because shell history records it.
