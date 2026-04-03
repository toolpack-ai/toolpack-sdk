# Git Identity Management Guide

This document explains how to manage multiple Git identities for different GitHub accounts and how to switch between them.

## Overview

When working with multiple GitHub accounts (personal, work, different clients), you need separate SSH keys and Git configurations. This setup allows you to seamlessly switch between identities.

---

## 1. SSH Key Configuration (`~/.ssh/config`)

Your SSH config file (`~/.ssh/config`) maps host aliases to specific SSH keys:

```
Host github.com-anshifa
    HostName github.com
    User git
    IdentityFile ~/.ssh/anshifa-gh
    IdentitiesOnly yes
    AddKeysToAgent yes

Host github.com-fentrex
    HostName github.com
    User git
    IdentityFile ~/.ssh/fentrex-gh
    IdentitiesOnly yes
    AddKeysToAgent yes

Host github.com-rianraj
    HostName github.com
    User git
    IdentityFile ~/.ssh/rianraj-gh
    IdentitiesOnly yes
    AddKeysToAgent yes

Host github.com-sajeer
    HostName github.com
    User git
    IdentityFile ~/.ssh/sajeer-gh
    IdentitiesOnly yes
    AddKeysToAgent yes
```

### Key Configuration Explained

| Setting | Description |
|---------|-------------|
| `Host` | The alias you use (e.g., `github.com-anshifa`) |
| `HostName` | The actual server (always `github.com`) |
| `User` | Git user (always `git`) |
| `IdentityFile` | Path to your private SSH key |
| `IdentitiesOnly yes` | Use only the specified key, not default keys |
| `AddKeysToAgent yes` | Automatically add key to SSH agent |

---

## 2. Git Config (`~/.gitconfig`)

Set up separate gitconfig files for each identity:

### Main `~/.gitconfig` (template)

```ini
[includeIf "gitdir:~/work/anshifa/"]
    path = ~/.gitconfig-anshifa

[includeIf "gitdir:~/work/fentrex/"]
    path = ~/.gitconfig-fentrex
```

### Individual Identity Configs

**`~/.gitconfig-anshifa`:**
```ini
[user]
    name = Anshifa
    email = anshifa@example.com
[github]
    user = anshifatk
```

**`~/.gitconfig-fentrex`:**
```ini
[user]
    name = Fentrex
    email = fentrex@example.com
[github]
    user = fentrexsolutions
```

---

## 3. Switching Git Identity with `as-<name>`

Use the `as-<name>` alias commands to quickly switch your Git identity:

### Setup Aliases (add to `~/.zshrc` or `~/.bashrc`)

```bash
# Git identity switchers
alias as-anshifa='git config --local user.name "Anshifa" && git config --local user.email "anshifa@example.com" && echo "Switched to anshifa identity"'
alias as-fentrex='git config --local user.name "Fentrex" && git config --local user.email "fentrex@example.com" && echo "Switched to fentrex identity"'
alias as-rian='git config --local user.name "Rian" && git config --local user.email "rian@example.com" && echo "Switched to rian identity"'
alias as-sajeer='git config --local user.email "sajeer@example.com" && echo "Switched to sajeer identity"'
```

### Usage

```bash
# Inside any git repository, switch to desired identity
as-anshifa

# Or for another account
as-fentrex
```

### Current Repository Remotes

This repository has the following remotes configured for SSH:

| Remote | URL | Identity |
|--------|-----|----------|
| `anshifa` | `git@github.com-anshifa:anshifatk/toolpack-sdk.git` | anshifa-gh |
| `fentrex` | `git@github.com-fentrex:fentrexsolutions/toolpack-sdk.git` | fentrex-gh |
| `rian` | `git@github.com-rianraj:rianrajpm/toolpack-sdk.git` | rianraj-gh |
| `sajeer` | `git@github.com-sajeer:sajeerzeji/toolpack-sdk.git` | sajeer-gh |
| `origin` | `https://github.com/toolpack-ai/toolpack-sdk.git` | (HTTPS) |

---

## 4. Pushing to Different Remotes

### Basic Push Commands

```bash
# Push to anshifa remote
git push -u anshifa anshifa-test

# Push to fentrex remote
git push -u fentrex feature-branch

# Push to rian remote
git push -u rian main

# Push to sajeer remote
git push -u sajeer dev-branch

# Push to origin (HTTPS - may prompt for token)
git push -u origin main
```

### Push with Specific Identity

```bash
# 1. First switch to the correct identity
as-anshifa

# 2. Push to the corresponding remote
git push -u anshifa anshifa-test
```

---

## 5. Adding a New User/Identity

### Step 1: Generate SSH Key

```bash
# Generate new SSH key with ed25519 (recommended)
ssh-keygen -t ed25519 -C "your-email@example.com" -f ~/.ssh/newuser-gh

# When prompted, don't set a passphrase (or set one if you prefer)
```

### Step 2: Add to SSH Config

Edit `~/.ssh/config` and add:

```
Host github.com-newuser
    HostName github.com
    User git
    IdentityFile ~/.ssh/newuser-gh
    IdentitiesOnly yes
    AddKeysToAgent yes
```

### Step 3: Add SSH Key to GitHub

1. Copy the public key:
   ```bash
   cat ~/.ssh/newuser-gh.pub
   ```

2. Go to GitHub → Settings → SSH and GPG keys → New SSH key
3. Paste the public key and save

### Step 4: Load Key and Test

```bash
# Add key to SSH agent
ssh-add ~/.ssh/newuser-gh

# Test connection
ssh -T git@github.com-newuser

# Should output: "Hi newuser! You've successfully authenticated..."
```

### Step 5: Add Git Config

Create `~/.gitconfig-newuser`:

```ini
[user]
    name = New User
    email = newuser@example.com
[github]
    user = newuser-github-username
```

### Step 6: Add Alias (optional)

Add to `~/.zshrc` or `~/.bashrc`:

```bash
alias as-newuser='git config --local user.name "New User" && git config --local user.email "newuser@example.com" && echo "Switched to newuser identity"'
```

### Step 7: Configure Remote URL

```bash
# For an existing remote
git remote set-url newuser git@github.com-newuser:username/repo.git

# Or add a new remote
git remote add newuser git@github.com-newuser:username/repo.git
```

---

## 6. Verification Commands

```bash
# List all loaded SSH keys
ssh-add -l

# Check specific GitHub account
ssh -T git@github.com-anshifa

# Verify remote URLs
git remote -v

# Check current git identity
git config user.name
git config user.email
```

---

## 7. Troubleshooting

### "Permission denied (publickey)"

1. Ensure key is loaded: `ssh-add ~/.ssh/key-name`
2. Check SSH config exists: `cat ~/.ssh/config`
3. Verify key is on GitHub: Check Settings → SSH keys

### "Could not resolve hostname"

The Host alias in `~/.ssh/config` doesn't match what you're using. Use `github.com-aliasname` format.

### Wrong identity being used

Always use `as-<name>` before committing, or set includeIf in main gitconfig based on directory.
