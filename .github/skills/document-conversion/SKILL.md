---
name: document-conversion
description: Use when converting documents (DOCX, PDF, XLSX) to themed HTML via the md_to_html.py pipeline, or when consolidating multiple source documents into portal-ready output
---

# Document Conversion — md_to_html.py Pipeline

## Overview

All manual/batch document conversion uses the **agent-driven md_to_html.py pipeline**. The agent (Claude) reads source documents, consolidates/deduplicates content, writes structured markdown, and `md_to_html.py` converts that markdown into themed HTML with full navigation amenities.

Conversion progress is tracked in **`docs/conversion/manifest.json`** — a git-tracked manifest that records every source DOCX file's SHA-256 hash, conversion status, and output mapping. The scanner (`scan_sources.py`) detects new/changed files so the pipeline can be re-run at any time to pick up changes.

This pipeline produces significantly higher quality output than the deprecated Azure AI pipeline (collection-converter.js) because:
- Claude Opus 4.6 has a 200K context window and deep reasoning vs GPT-4.1-mini's limited context and 30-second timeout
- The agent verifies each document interactively instead of fire-and-forget batch processing
- Consolidation decisions (dedup, what supersedes what, section structure) benefit from agent-level intelligence

### Pipeline Flow

```
scan_sources.py --update          # Discover new/changed DOCX, update manifest
  → Agent reviews new/changed files from manifest
  → Agent reads/extracts content (python-docx, or reads text directly)
  → Agent consolidates, deduplicates, resolves overlaps
  → Agent writes structured markdown (.md)
  → md_to_html.py converts markdown → themed HTML
  → scan_sources.py --mark-converted <key> <files...>   # Update manifest
  → Output committed to git, indexed by portal
```

### Conversion Modes in md_to_html.py

| Flag | Registry | Function | Output |
|------|----------|----------|--------|
| (default) | `DOCS` | `convert_document()` | IT Ops formal docs (776.HME.NNNN) |
| `--dsk` | `DOCS_DSK` | `convert_dsk_document()` | Desktop Support docs |
| `--ref` | `DOCS_REF` | `convert_ref_document()` | Reference/technical docs |

### What Mode 1 Auto-Conversion Still Does

The portal's `doc-converter.js` still runs **Mode 1 automatic 1:1 conversion** on server start for sync paths with `convert: true`. This converts individual DOCX/PDF from SharePoint sync into HTML using Azure Document Intelligence. That codepath is unchanged — it handles the formal DOCX pipeline (31 numbered docs from `Published/word/`).

**Mode 2 collection consolidation (collection-converter.js) is deprecated.** Do not use it for new conversions.

## File Locations

```
docs/conversion/
  md_to_html.py                           # ★ CANONICAL converter — markdown → themed HTML
  scan_sources.py                         # ★ Source scanner — tracks conversion manifest
  manifest.json                           # ★ Conversion manifest — SHA-256 hashes, status
  seed_manifest.py                        # One-time seeder (run once to initialize)
  convert-pca-mes.js                      # PCA/MES one-off conversion (manual)
  convert-collection-cli.js               # ⚠️ DEPRECATED — Azure AI pipeline CLI

Scripts/doc-library-portal/
  src/services/
    doc-converter.js                      # Mode 1 auto-conversion (still active)
    collection-converter.js               # ⚠️ DEPRECATED — Azure AI collection pipeline
    doc-enhancer.js                       # ⚠️ DEPRECATED for collections — GPT enhancement
    doc-intelligence.js                   # Azure DI client (still used by Mode 1)

Document Library/Published/
  markdown/                               # Source markdown files (IT Ops)
  html/                                   # Output HTML files

_Desktop Support/_Published/
  markdown/                               # Source markdown files (Desktop Support)
  html/                                   # Output HTML files
```

## The Conversion Workflow (Step by Step)

### Phase 0: Scan for New/Changed Files

**Before starting any conversion work**, run the scanner to see what needs attention:

```bash
# Scan and report (read-only)
python docs/conversion/scan_sources.py

# Scan and update manifest with new entries
python docs/conversion/scan_sources.py --update

# View per-directory status summary
python docs/conversion/scan_sources.py --status
```

The scanner walks configured directories, computes SHA-256 hashes, and compares against `manifest.json`. It reports:
- **New** — DOCX on disk, not in manifest (needs conversion)
- **Changed** — DOCX on disk with different hash (may need re-conversion)
- **Converted** — already processed, hash unchanged
- **Skipped** — intentionally excluded with documented reason

Use the scanner output to decide which files to convert. Focus on `new` and `changed` files.

To mark files that should be permanently skipped:
```bash
python docs/conversion/scan_sources.py --skip "Network/SANDC" --reason "Deprecated datacenter"
```

### Phase 1: Group & Extract Sources

For each topic/document you're converting:

1. **Identify source files from manifest** — Use `scan_sources.py --status` to find unconverted DOCX
2. **Extract text from DOCX** — Use `python-docx` to read paragraphs, or read the file directly
3. **Extract images from DOCX** — Unzip the DOCX, copy `word/media/*` to `html/images/<topic>/`
4. **Copy attachments** — Spreadsheets, Visio, PDFs that should be linked (not converted) go to `attachments/`
5. **Gate:** Produce a source inventory with file count, image count, content summary

### Phase 2: Write Consolidated Markdown

1. **Read all extracted text** for the topic
2. **Identify overlaps** — newer supersedes older, remove duplicates
3. **Write single structured markdown** with these sections:
   - Overview — what this system is, who uses it
   - Prerequisites / Access — what you need before starting
   - Setup & Installation — initial configuration procedures
   - Common Tasks — day-to-day procedures (the core content)
   - Troubleshooting — known issues and fixes
   - Escalation — when to escalate, who to contact
   - Reference — embedded tables from spreadsheets, links to attachments
4. **Gate:** All source content accounted for, no fabricated details, image references match extracted files

### Phase 3: Register & Generate HTML

1. **Add entry to the appropriate registry** in `md_to_html.py`:

For Desktop Support (`DOCS_DSK`):
```python
{
    'name': 'mitel',
    'title': 'Mitel Phone System',
    'category': 'Telephony',
    'description': 'Complete Mitel phone system reference.',
    'md': '_Desktop Support/_Published/markdown/Mitel_Phone_System.md',
    'html': '_Desktop Support/_Published/html/Mitel_Phone_System.html',
},
```

For IT Ops formal docs (`DOCS`):
```python
{
    'key': '0002',
    'number': '776.HME.0002',
    'type': 'WI',
    'version': 'v1.0',
    'date': '26-MAR-2024',
    'highlight': 'AX WCF HA',
    'title_rest': 'Reverse Proxy Diagram',
    'short_name': 'AX_WCF_Reverse_Proxy_HA_Diagram',
    'description': 'Network architecture diagram.',
    'md': 'Document Library/Published/markdown/Work Instruction/776.HME.0002.WI-AX_WCF_Reverse_Proxy_HA_Diagram-v1.0.md',
},
```

For Reference/Technical docs (`DOCS_REF`):
```python
{
    'key': '0040',
    'number': '776.HME.0040',
    'type': 'REF',
    'version': 'v1.0',
    'date': '12-FEB-2026',
    'highlight': 'Azure Infrastructure',
    'title_rest': 'Reference Guide',
    'short_name': 'Azure_Infrastructure',
    'description': 'Azure cloud infrastructure reference.',
    'md': 'Document Library/Published/markdown/Reference Documents/776.HME.0040.REF-Azure_Infrastructure-v1.0.md',
},
```

2. **Run the converter:**

```bash
# Desktop Support docs
python docs/conversion/md_to_html.py --dsk <name>

# IT Ops docs
python docs/conversion/md_to_html.py <key>

# Reference docs
python docs/conversion/md_to_html.py --ref <key>

# All docs in a registry
python docs/conversion/md_to_html.py --dsk
```

3. **Verify output** — section count, image count, navigation amenities

4. **Update manifest** — Mark source DOCX files as converted:
```bash
python docs/conversion/scan_sources.py --mark-converted <output_key> \
  "Document Library/Technical/networking/palo-alto/GlobalProtect VPN Config.docx" \
  "Document Library/Technical/networking/palo-alto/Panorama Upgrade.docx"
```

5. **Commit** — HTML + images + attachments + registry update + manifest

## HTML Template Features

The `md_to_html.py` converter produces themed HTML with:

- Dark/light theme toggle (CSS variables, stored in localStorage)
- Collapsible TOC sidebar with scrollspy highlighting
- Reading progress bar
- In-page search with highlighting
- Section anchors with deep-linking
- Responsive layout with mobile support
- JetBrains Mono + IBM Plex Sans fonts
- Print-friendly styles

## Hard Constraints (Iron Laws)

These apply to ALL conversion work:

1. **Do NOT fabricate technical details** — IPs, credentials, server names, versions. Flag uncertain content with `> **ℹ NOTE:** [needs verification]`
2. **Image Iron Law** — Do NOT replace images with text descriptions like "screenshot showing the dialog." Extract and preserve images. If extraction fails, flag for manual re-insertion.
3. **Do NOT remove original content** — consolidate and restructure, but preserve all substantive information from source documents
4. **Do NOT add content** that wasn't in the source documents — you consolidate, not author

## Verification Checklist

After conversion, confirm:

| Check | What to Look For |
|-------|-----------------|
| All sections render | Every section from source appears in output |
| Theme toggle | Light/dark switch works |
| TOC generates | Table of Contents lists all major headings |
| Tables | Properly formatted |
| Images | Match extracted image count from sources |
| No content loss | Compare source doc count against output coverage |
| Scrollspy | Active section highlights in TOC as you scroll |

## Re-Running the Pipeline (Ongoing Maintenance)

The pipeline is designed to be re-run at any time. To pick up new or changed files:

```bash
# 1. Scan for changes
python docs/conversion/scan_sources.py --update

# 2. Check what needs attention
python docs/conversion/scan_sources.py --status

# 3. Convert new/changed files (agent-driven workflow above)
# 4. After each conversion, mark files as converted:
python docs/conversion/scan_sources.py --mark-converted <output_key> <files...>

# 5. Commit manifest.json alongside conversion outputs
```

### Manifest Configuration

The manifest's `config` section controls which directories are scanned:

```json
{
  "include_dirs": ["Document Library/Technical", "Security", "SITES", ...],
  "exclude_dirs": ["_archive", ".git", "Scripts", ...],
  "exclude_patterns": ["Network/SANDC", "~$"],
  "extensions": [".docx"]
}
```

To add new source directories, edit `manifest.json` → `config.include_dirs` and re-run `--update`.

### File Status Values

| Status | Meaning |
|--------|---------|
| `new` | Discovered, not yet converted |
| `converted` | Processed, maps to output doc via `output_key` |
| `changed` | Hash differs from last conversion — may need re-conversion |
| `skip` | Intentionally excluded with documented `reason` |

## Deprecated: Azure AI Collection Pipeline

> **⚠️ Do not use for new conversions.**
>
> `collection-converter.js` and `convert-collection-cli.js` used Azure Document
> Intelligence for extraction + GPT-4.1-mini for triage and enhancement. This
> produced significantly lower quality output than the agent-driven workflow:
> - Per-section GPT enhancement timed out on large documents
> - 30-second timeout caused many sections to be skipped entirely
> - GPT-4.1-mini's limited context produced fragmented, inconsistent output
> - No interactive quality verification per document
>
> The files are retained in the codebase with deprecation notices but should not
> be used for any new conversion work.
>
> Mode 1 auto-conversion (doc-converter.js) is NOT deprecated — it still handles
> the formal DOCX pipeline for individual file conversion on server start.
