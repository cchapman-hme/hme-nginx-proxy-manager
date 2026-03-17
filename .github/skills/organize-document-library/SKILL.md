---
name: organize-document-library
description: Use when reviewing, sorting, or organizing unstructured documents into the Document Library hierarchy
---

# Organize Document Library

## Overview

This skill guides the process of reviewing and organizing unstructured documents into HME's structured **`Document Library/`** folder hierarchy. It integrates the `doc-organizer` extraction pipeline to read binary document formats.

**Target directory:** `Document Library/` (with `n
/` as a parallel top-level folder for site-specific content)

**Core principle:** Understand content before categorizing. Extract → Review → Categorize → Move → Verify.

## When to Use

Use this skill when:
- Organizing documents from unstructured folders into Document Library
- Reviewing a folder's contents to determine where documents belong
- Auditing existing content for duplicates or miscategorization
- Migrating documents from legacy locations

**Do NOT use for:**
- Creating new documents (use writing workflows instead)
- Building the documentation portal (separate build pipeline)
- Desktop Support content (`_Desktop Support/` is off-limits)

## The Iron Laws

```
1. NEVER DELETE ANY DOCUMENT — Move to _archive/ instead
2. NEVER MOVE DOCUMENTS WITHOUT UNDERSTANDING THEIR CONTENT FIRST
```

**Safety first:** Documents are NEVER deleted, only reorganized. If a document is a duplicate, outdated, or doesn't belong anywhere, move it to `Document Library/_archive/`. This preserves history and allows recovery.

If you cannot read a document's content, extract it first. Guessing from filenames leads to miscategorization.

## Target Structure Reference

```
Document Library/
├── Published/              # Formal 776.HME numbered documents
│   ├── pdf/                # Final PDFs (read-only)
│   ├── source/             # Source files (docx, vsdx)
│   └── web/                # HTML/Markdown conversions
├── Technical/              # Operational docs BY TOPIC
│   ├── applications/       # Boomi, EFACS, ADP, Jenkins, etc.
│   ├── cloud/              # Azure, M365, Intune
│   ├── networking/         # Cisco, Meraki, Palo Alto, VPN
│   ├── scripting/          # PowerShell, SQL, automation
│   ├── security/           # CrowdStrike, Duo, Nessus, Varonis
│   ├── servers/            # ProxMox, VMware, Windows, Linux
│   ├── storage-backup/     # Veeam, Iron Mountain, SAN
│   └── telecom/            # Phones, Clear-Com, conference
├── Drafts/                 # Work-in-progress documents
│   ├── active/
│   └── in-review/
├── Reference/              # Reference data and scripts
├── _archive/               # Deprecated/superseded content
└── _templates/             # Reusable templates

SITES/                      # Site-specific (TOP LEVEL, parallel)
├── ALM/                    # Alameda
├── ATL/                    # Atlanta
├── BLR/                    # Bangalore
├── CAM/                    # Cambridge UK
├── CLD/                    # Carlsbad (HQ)
├── KNG/                    # Kingsclere UK
├── LAS/                    # Las Vegas DC
├── MON/                    # Montreal
├── STL/                    # St Louis
├── SUW/                    # Suwanee
└── TOR/                    # Toronto
    └── (each site has these standard subfolders - lowercase):
        ├── contacts/       # Phone systems, vendor contacts, emergency info
        ├── diagrams/       # Site layouts, rack diagrams, network diagrams
        ├── historical/     # Legacy docs, migration records, decommissioned
        ├── inventory/      # Hardware inventory, asset tracking
        ├── network/        # Network configs, WiFi, switches, firewalls
        ├── photos/         # Site photos, rack photos, equipment photos
        ├── power/          # UPS, PDU, power distribution docs
        ├── proxmox/        # Proxmox cluster configuration
        └── telecom/        # Phone systems, conference rooms, Clear-Com
```

**SITES folder naming:** Always use **lowercase** for subfolders. If you find mixed-case folders (e.g., `Network/`, `Diagrams/`, `ProxMox/`), normalize them to lowercase during organization.

## Categorization Decision Guide

**All organized documents go to `Document Library/` EXCEPT site-specific content which goes to `SITES/`.**

| If the document is... | Destination |
|-----------------------|-------------|
| Formal 776.HME numbered SOP or WI | `Document Library/Published/` |
| Draft of a numbered document | `Document Library/Drafts/active/` or `in-review/` |
| How-to, runbook, config guide for a technology | `Document Library/Technical/<topic>/` |
| Specific to a physical site (rack, IPs, cabling) | `SITES/<code>/<subfolder>/` ⚠️ NOT in Document Library |
| Reusable template | `Document Library/_templates/` |
| Deprecated or superseded | `Document Library/_archive/` |
| Reference dataset or utility script | `Document Library/Reference/` |
| Duplicate of existing document | `Document Library/_archive/duplicates/` |

### Understanding Published Documents (776.HME)

**Published documents are FORMAL, numbered SOPs and Work Instructions** that follow HME's documentation standard.

**Naming convention:** `776.HME.NNNN-<Type>-<Title>-vX.Y`
- **776.HME** = HME Infrastructure document prefix
- **NNNN** = Sequential document number (0001, 0002, etc.)
- **Type** = `SOP` (Standard Operating Procedure) or `WI` (Work Instruction)
- **vX.Y** = Version number

**Examples:**
- `776.HME.0008-SOP-Jenkins-v1.0.docx` → SOP for Jenkins administration
- `776.HME.0021-WI-Palo Alto-v1.0.docx` → Work Instruction for Palo Alto config
- `776.HME.0028-SOP-Meraki-v1.0.docx` → SOP for Meraki management

**SOP vs WI distinction:**
| Type | Purpose | Audience |
|------|---------|----------|
| **SOP** (Standard Operating Procedure) | Routine operational procedures, regular maintenance | Operations team |
| **WI** (Work Instruction) | Step-by-step technical instructions, how-to guides | Technical staff |

**If a document has a 776.HME number:** It goes in `Document Library/Published/`
- Source file (.docx) → `Published/source/`
- PDF version → `Published/pdf/`

**If a document SHOULD be formalized but isn't numbered yet:** It stays in `Document Library/Technical/` or goes to `Document Library/Drafts/` for review

### Technical Topic Mapping

| Content About | → Topic Folder |
|---------------|----------------|
| AX, D365, EFACS, Boomi, Jenkins, Chef | `applications/` |
| Azure, M365, Intune, O365 | `cloud/` |
| Cisco, Meraki, Palo Alto, VPN, firewalls | `networking/` |
| PowerShell, SQL, bash scripts, automation | `scripting/` |
| CrowdStrike, Duo, Nessus, Varonis, certificates | `security/` |
| VMware, ProxMox, Windows Server, Linux | `servers/` |
| Veeam, Iron Mountain, SAN, backup procedures | `storage-backup/` |
| Phones, Clear-Com, Mitel, conference rooms | `telecom/` |

### SITES Subfolder Mapping

When organizing site-specific content, use these **9 standard subfolders** (lowercase):

| Content Type | → Subfolder | Examples |
|--------------|-------------|----------|
| Vendor contacts, phone lists, emergency info | `contacts/` | After-hours contacts, vendor escalation |
| Site maps, rack layouts, network topology | `diagrams/` | Floor plans, Visio diagrams, rack elevations |
| Legacy docs, old migrations, decommissioned | `historical/` | Server relocation records, retired systems |
| Hardware tracking, asset lists | `inventory/` | Serial numbers, warranty info, equipment lists |
| Switch configs, WiFi, firewall rules | `network/` | VLAN maps, IP assignments, wireless surveys |
| Rack photos, equipment pictures, site images | `photos/` | Installation photos, before/after shots |
| UPS, PDU configs, power distribution | `power/` | APC EcoStruxure, battery replacement logs |
| Proxmox cluster docs specific to site | `proxmox/` | Node configs, storage pools, HA settings |
| Phones, conference rooms, Clear-Com | `telecom/` | Mitel configs, room scheduling, intercom |

**Non-standard folders to consolidate:** If you find other subfolders (e.g., `server-room/`, `CCMAG Servers/`, `Floor Plan/`), move their contents into the appropriate standard folder:
- `server-room/` → contents to `inventory/` or `network/` or `proxmox/`
- `Floor Plan/` → contents to `diagrams/`
- `CCMAG Servers/` → contents to `inventory/` or `telecom/`

## Phase 1: Audit Source Folder

**BEFORE moving anything, understand what you're working with.**

### Step 1.1: Run Inventory

```powershell
cd "scripts\doc-organizer"
& "C:\Program Files\nodejs\node.exe" inventory.js "<source-folder-path>" --output audit.json
```

This reveals:
- Total files and size
- File type breakdown
- What can be extracted vs. metadata-only

### Step 1.2: Extract Readable Documents

For folders with binary documents:

```powershell
# Extract all supported formats to temp files
& "C:\Program Files\nodejs\node.exe" extract.js "<source-folder>" --types "docx,pdf,xlsx" --output extraction-report.json

# Or limit for large folders
& "C:\Program Files\nodejs\node.exe" extract.js "<source-folder>" --max 50 --output extraction-report.json
```

**Temp files location:** `%TEMP%\doc-organizer-temp\`

### Step 1.3: Review Content

Read extracted content to understand each document:

```powershell
# Read specific document
& "C:\Program Files\nodejs\node.exe" read-doc.js "<path-to-file>" --excerpt

# Read full content
& "C:\Program Files\nodejs\node.exe" read-doc.js "<path-to-file>"
```

**For AI assistance:** Share the temp file contents or extraction report with the assistant.

## Phase 2: Categorize Documents

### Step 2.1: Create Categorization Plan

For each document, determine:

1. **Category** - Which destination folder?
2. **Subfolder** - Which topic or site subfolder?
3. **Action** - Move, archive, or leave? (NEVER delete)
4. **Notes** - Any renaming or special handling

Document this in a table:

| File | Current Location | Destination | Action | Notes |
|------|------------------|-------------|--------|-------|
| AX-Guide.docx | Source/AX/ | Document Library/Technical/applications/ax/ | Move | — |
| Old-VPN.pdf | Source/Network/ | _archive/ | Archive | Superseded by 0021 |
| CLD-Rack.vsdx | Source/Diagrams/ | SITES/CLD/diagrams/ | Move | — |

### Step 2.2: Check for Duplicates

Before moving, verify document doesn't already exist:

```powershell
# Search for similar files
Get-ChildItem -Path "Document Library" -Recurse -Filter "*keyword*"
```

If duplicate found:
- Compare dates and content
- Keep the more complete/recent version
- Archive the duplicate to `_archive/duplicates/`

### Step 2.3: Validate Categorization

Ask yourself:
- Does this document's CONTENT match the category? (not just filename)
- Is it site-specific or technology-generic?
- Is it current or deprecated?
- Does it overlap with a Published document?

## Phase 3: Execute Moves

### Step 3.1: Create Target Folders (if needed)

```powershell
New-Item -ItemType Directory -Path "Document Library\Technical\<topic>\<subfolder>" -Force
```

### Step 3.2: Move Documents

```powershell
# Single file
Move-Item -Path "<source>" -Destination "<target>"

# Multiple files
Get-ChildItem -Path "<source-folder>" -Filter "*.docx" | Move-Item -Destination "<target-folder>"
```

### Step 3.3: Archive Empty Source Folders

After migrating all content:

```powershell
# Move empty source folder to archive
Move-Item -Path "<source-folder>" -Destination "Document Library\_archive\legacy-folders\"
```

### Step 3.4: Normalize SITES Folder Structure (if working on SITES)

When organizing a site folder, normalize any non-standard subfolders:

```powershell
# Example: Normalize CLD site folder structure
$site = "SITES\CLD"

# Rename mixed-case folders to lowercase
Rename-Item -Path "$site\Network" -NewName "network" -ErrorAction SilentlyContinue
Rename-Item -Path "$site\Diagrams" -NewName "diagrams" -ErrorAction SilentlyContinue
Rename-Item -Path "$site\ProxMox" -NewName "proxmox" -ErrorAction SilentlyContinue
Rename-Item -Path "$site\Photos" -NewName "photos" -ErrorAction SilentlyContinue
Rename-Item -Path "$site\Power" -NewName "power" -ErrorAction SilentlyContinue
Rename-Item -Path "$site\Historical" -NewName "historical" -ErrorAction SilentlyContinue
Rename-Item -Path "$site\Inventory" -NewName "inventory" -ErrorAction SilentlyContinue

# Move contents from non-standard folders, then remove empty folder shell
# Example: Floor Plan → diagrams
Get-ChildItem -Path "$site\Floor Plan" | Move-Item -Destination "$site\diagrams\"
Remove-Item -Path "$site\Floor Plan" -ErrorAction SilentlyContinue

# Example: server-room → distribute to appropriate folders
# (review contents first, then move to inventory/, network/, or proxmox/)
```

**Standard SITES subfolders (9 total, lowercase):**
`contacts`, `diagrams`, `historical`, `inventory`, `network`, `photos`, `power`, `proxmox`, `telecom`

## Phase 4: Verify and Clean Up

### Step 4.1: Verify Moves

```powershell
# Check target folder has expected content
Get-ChildItem -Path "<target-folder>" -Recurse | Select-Object Name, Length, LastWriteTime
```

### Step 4.2: Clean Up Temp Files

**CRITICAL:** Always clean up extraction temp files when done.

```powershell
cd "scripts\doc-organizer"
& "C:\Program Files\nodejs\node.exe" cleanup.js --force
```

### Step 4.3: Update Tracking

Update `docs/ISSUES.md` with:
- What was migrated
- File counts by destination
- Any duplicates found and resolved
- Archive summary

## Working with AI Assistant

When asking the AI to help organize:

1. **Provide context:** Share the extraction report or inventory JSON
2. **Share content:** Paste extracted text for categorization help
3. **Confirm moves:** Review proposed categorization before executing
4. **Report back:** Share results of moves for tracking updates

### Example Prompt

```
I need help organizing documents from Network/Troubleshooting/.

Here's the inventory:
[paste inventory.js output or audit.json]

Here's the extracted content from the key documents:
[paste read-doc.js output or temp file content]

Please suggest categorization for each document using the Document Library structure.
```

## Quick Reference: Extraction Commands

| Task | Command |
|------|---------|
| Audit folder | `node inventory.js "<folder>"` |
| Extract batch | `node extract.js "<folder>" --types "docx,pdf"` |
| Read single doc | `node read-doc.js "<file>"` |
| Read excerpt | `node read-doc.js "<file>" --excerpt` |
| Show temp stats | `node cleanup.js` |
| Delete temp files | `node cleanup.js --force` |

**Note:** Run from `scripts\doc-organizer\` directory. Use full path to node.exe if not in PATH:
```powershell
& "C:\Program Files\nodejs\node.exe" <script.js> <args>
```

## Anti-Patterns

❌ **DELETING ANY DOCUMENT** — NEVER delete documents. Archive duplicates/obsolete files to `_archive/`  
❌ **Moving by filename only** — "AX" in filename doesn't mean it belongs in applications/ax/  
❌ **Skipping duplicate check** — Creates conflicting versions  
❌ **Leaving temp files** — Fills up temp directory (temp extraction files CAN be deleted)  
❌ **Moving entire folders blindly** — Always review contents first  
❌ **Forgetting to update ISSUES.md** — Loses migration history  

## Success Criteria

A folder is successfully organized when:
- [ ] All documents categorized based on CONTENT (not filename)
- [ ] Duplicates identified and resolved
- [ ] All documents moved to correct destinations
- [ ] Source folder archived (empty shells can be removed)
- [ ] Temp files cleaned up
- [ ] ISSUES.md updated with migration summary
