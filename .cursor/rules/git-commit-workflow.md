# Git Commit Workflow

## GPG Signature Required

This repository uses GPG-signed commits. When making Git commits:

### Process

1. **Stage changes**: `git add .`
2. **Commit**: `git commit -m "message"`
3. **Provide Passphrase**: Kleopatra UI will prompt for GPG passphrase
   - Wait for the Kleopatra dialog to appear
   - Enter passphrase in the Kleopatra UI (not in terminal)
   - Click OK to sign the commit

### GPG Key Information

- **User ID**: Benjamin Alloul <Benjamin.Alloul@gmail.com>
- **Key ID**: 598E BCC2 F7CA D3BA
- **Valid From**: 04/01/2026
- **Status**: Certified

### Important Notes

- ⚠️ **DO NOT** try to bypass the GPG prompt
- ⚠️ **DO NOT** use `--no-gpg-sign` flag
- ⚠️ **DO NOT** attempt to pipe passphrase via stdin
- ✅ **DO** wait for Kleopatra UI dialog
- ✅ **DO** inform the user when a commit needs their GPG passphrase

### When Making Commits

After running `git commit`, always:
1. Check if Kleopatra dialog appeared
2. Wait for user to enter passphrase
3. Verify commit succeeded with `git log --oneline -1`

### Troubleshooting

If commit hangs:
- Check if Kleopatra dialog is hidden behind other windows
- Bring Kleopatra to foreground (check system tray)
- If Kleopatra is not responding, restart the application

### Alternative for Quick Changes

For non-permanent work commits during development:
```bash
git commit -S -m "WIP: message"  # -S explicitly requests GPG signing
```

The `-S` flag makes it clear that GPG signing is required and Kleopatra will prompt.

---

**Created**: 2026-04-01  
**Last Updated**: 2026-04-01
