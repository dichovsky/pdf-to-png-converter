# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 4.x     | ✅ Yes    |
| 3.x     | ❌ No     |
| < 3.0   | ❌ No     |

## Reporting a Vulnerability

Please **do not** put the details of a security vulnerability in a public GitHub issue.

Private vulnerability reporting through GitHub Security Advisories is not currently enabled for this repository. Until it is, open a [GitHub issue](https://github.com/dichovsky/pdf-to-png-converter/issues/new) that only asks the maintainers for a private way to send a security report, and leave out any details of the vulnerability. Send the details only once the maintainers have given you that private channel.

When you send the details, include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (proof-of-concept code or a minimal test case)
- The affected version(s)

**Expected response time:** You will receive an acknowledgement within 5 business days and a status update within 14 business days.

Once a fix is ready and a new release is published, the advisory will be made public.

## Passwords on the Command Line

`--pdf-file-password` puts the password in the process arguments, so other local users can read it in a process listing, and shell history and audit logs keep it. Prefer the `PDF_TO_PNG_PASSWORD` environment variable, which the CLI reads when the flag is not given and which other local users cannot read from a process listing, or the `pdfFilePassword` option of the library. Quote a password that contains spaces: the CLI's usage error for a second path lists every stray argument. Supply the variable from a secret store or CI secret instead of typing it in front of the command, because shell history records that too.
