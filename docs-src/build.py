#!/usr/bin/env python3
"""
Build the docrev documentation site using pandoc + Bootstrap 5 Sandstone.

Usage (from project root):
    python docs-src/build.py           # build to site/
    python docs-src/build.py --serve   # build + open index.html
    python docs-src/build.py --deploy  # build + push to gh-pages
"""

import argparse
import json
import shutil
import subprocess
import sys
import webbrowser
from pathlib import Path

HERE        = Path(__file__).parent          # docs-src/
PROJECT     = HERE.parent                    # project root
DOCS        = PROJECT / "docs"
SITE        = PROJECT / "site"
TEMPLATE    = HERE / "template.html"
EXTRA_CSS   = HERE / "extra.css"
LUA_FILTER  = HERE / "md-to-html.lua"

PAGES = [
    # (source md,          output html,            page title,      active-key,              toc)
    ("index.md",          "index.html",          "Home",          "active-home",           False),
    ("workflow.md",       "workflow.html",       "Get Started",   "active-workflow",       True),
    ("commands.md",       "commands.html",       "Commands",      "active-commands",       True),
    ("configuration.md",  "configuration.html",  "Configuration", "active-configuration",  True),
    ("troubleshooting.md","troubleshooting.html","Troubleshooting","active-troubleshooting",True),
]


def get_version() -> str:
    pkg = PROJECT / "package.json"
    if pkg.exists():
        return json.loads(pkg.read_text())["version"]
    return ""


def build_page(md_name, html_name, title, active_key, use_toc, version):
    src = DOCS / md_name
    dst = SITE / html_name

    cmd = [
        "pandoc", str(src),
        "--template", str(TEMPLATE),
        "--to", "html5",
        "--from", "markdown+smart+definition_lists",
        "--highlight-style", "pygments",
        "--lua-filter", str(LUA_FILTER),
        "--metadata", f"title={title}",
        "--metadata", f"pagetitle={title}",
        "--metadata", f"version={version}",
        "--metadata", f"{active_key}=true",
        "--output", str(dst),
    ]

    if use_toc:
        cmd += ["--toc", "--toc-depth=3"]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERROR: {md_name}")
        print(result.stderr)
        return False

    print(f"  {html_name}")
    return True


def build(deploy=False, serve=False):
    if SITE.exists():
        shutil.rmtree(SITE)
    SITE.mkdir()
    assets = SITE / "assets"
    assets.mkdir()

    shutil.copy(EXTRA_CSS, assets / "extra.css")

    version = get_version()
    print(f"Building docrev {version} → site/")

    ok = all(build_page(*p, version) for p in PAGES)

    if not ok:
        sys.exit(1)

    print("Done.")

    if serve:
        webbrowser.open(str(SITE / "index.html"))

    if deploy:
        print("\nDeploying to gh-pages …")
        result = subprocess.run(
            ["python", "-m", "ghp_import", "-n", "-p", "-f", str(SITE)],
            cwd=PROJECT,
        )
        if result.returncode != 0:
            sys.exit(result.returncode)
        print("Deployed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--serve",  action="store_true", help="Open index.html after build")
    parser.add_argument("--deploy", action="store_true", help="Push site/ to gh-pages")
    args = parser.parse_args()
    build(deploy=args.deploy, serve=args.serve)
