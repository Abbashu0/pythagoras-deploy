#!/usr/bin/env python3
"""Convert hardcoded px font-sizes to rem so they scale with --density-multiplier."""
import re
import os

files = [
    '/home/z/my-project/public/pythagoras/src/styles/placeholders.css',
    '/home/z/my-project/public/pythagoras/src/styles/tools.css',
    '/home/z/my-project/public/pythagoras/src/styles/navigation.css',
    '/home/z/my-project/public/pythagoras/src/styles/components.css',
    '/home/z/my-project/public/pythagoras/src/styles/tests.css',
]

total = [0]

def replace_px(match):
    px_val = float(match.group(1))
    rem_val = px_val / 16
    if rem_val == int(rem_val):
        rem_str = f"{int(rem_val)}rem"
    else:
        rem_str = f"{rem_val:.4f}rem".rstrip('0').rstrip('.')
    total[0] += 1
    return f"font-size: {rem_str};"

for fpath in files:
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()
    new_content = re.sub(r'font-size:\s*(\d+(?:\.\d+)?)px;', replace_px, content)
    if new_content != content:
        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"  ✓ {os.path.basename(fpath)}")
    else:
        print(f"  - {os.path.basename(fpath)}: no changes")

print(f"\nTotal conversions: {total[0]}")
