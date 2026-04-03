# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Which versions are eligible for receiving such patches depends on the CVSS v3.0 Rating:

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| < latest | :x:                |

We currently support only the latest version with security updates. Please ensure you are using the most recent version of the toolpack-sdk.

## Reporting a Vulnerability

We take the security of toolpack-sdk seriously. If you have discovered a security vulnerability, we appreciate your help in disclosing it to us in a responsible manner.

### Where to Report

Please **DO NOT** report security vulnerabilities through public GitHub issues.

Instead, please report security vulnerabilities by:

1. **GitHub Security Advisories** (Preferred): Use the [GitHub Security Advisory](https://github.com/toolpack-ai/toolpack-sdk/security/advisories/new) feature to privately report vulnerabilities.

2. **Email**: If you prefer, you can also send an email describing the vulnerability. Please include:
   - Type of issue (e.g., buffer overflow, SQL injection, cross-site scripting, etc.)
   - Full paths of source file(s) related to the manifestation of the issue
   - The location of the affected source code (tag/branch/commit or direct URL)
   - Any special configuration required to reproduce the issue
   - Step-by-step instructions to reproduce the issue
   - Proof-of-concept or exploit code (if possible)
   - Impact of the issue, including how an attacker might exploit it

### What to Expect

After you have submitted a vulnerability report, you can expect:

- **Acknowledgment**: We will acknowledge receipt of your vulnerability report within 48 hours.
- **Communication**: We will send you regular updates about our progress as we investigate and address the issue.
- **Timeline**: We aim to:
  - Confirm the problem and determine the affected versions within 7 days
  - Release a fix and publish a security advisory as soon as possible, typically within 30 days
- **Credit**: If you wish, we will publicly acknowledge your responsible disclosure after the vulnerability is fixed.

### Disclosure Policy

When we receive a security bug report, we will:

1. Confirm the problem and determine the affected versions
2. Audit code to find any similar problems
3. Prepare fixes for all supported versions
4. Release new versions and publish a security advisory

We request that you:

- Give us reasonable time to investigate and fix the issue before disclosing it publicly
- Make a good faith effort to avoid privacy violations, destruction of data, and interruption or degradation of our services
- Do not exploit the vulnerability beyond what is necessary to demonstrate the issue

## Security Best Practices for Users

When using toolpack-sdk:

- Always use the latest version
- Keep your dependencies up to date
- Be cautious when using execution tools that run shell commands
- Validate and sanitize all user inputs
- Follow the principle of least privilege when granting file system access
- Review the permissions and capabilities required by tools before use
- Be careful when using network tools to prevent unintended data exposure

## Comments on This Policy

If you have suggestions on how this process could be improved, please submit a pull request or open an issue to discuss.
