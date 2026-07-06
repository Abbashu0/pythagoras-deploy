#!/usr/bin/env python3
"""Insert bindSponsoredCarousel() call + function into app.js, handling mixed CRLF/LF."""
import re

path = '/home/z/my-project/public/pythagoras/src/scripts/app.js'
with open(path, 'rb') as f:
    data = f.read()

# Normalize to \n for editing, remember original had mixed endings
text = data.decode('utf-8')

# The bindInteractions function — match with any line endings
old = "function bindInteractions(view) {\n  bindNavigationInteractions(view, renderView, resolveNavTarget);\n  bindBackInteractions();\n  bindLockedToolInteractions();\n  bindTestsFeatureInteractions();\n  bindThemeInteractions();\n  bindSettingsAppearanceInteractions(view);\r\n  bindQuestionBankInteractions(view);\r\n  bindQuestionDetailInteractions(view);\r\n}"

new = "function bindInteractions(view) {\n  bindNavigationInteractions(view, renderView, resolveNavTarget);\n  bindBackInteractions();\n  bindLockedToolInteractions();\n  bindTestsFeatureInteractions();\n  bindThemeInteractions();\n  bindSettingsAppearanceInteractions(view);\r\n  bindQuestionBankInteractions(view);\r\n  bindQuestionDetailInteractions(view);\r\n  bindSponsoredCarousel();\r\n}\r\n\r\nfunction bindSponsoredCarousel() {\r\n  // Always tear down the previous controller first — render() replaces the entire\r\n  // #screen-content subtree, so any prior carousel DOM is gone and its listeners\r\n  // would otherwise leak.\r\n  if (sponsoredCarouselController) {\r\n    sponsoredCarouselController.destroy();\r\n    sponsoredCarouselController = null;\r\n  }\r\n\r\n  const root = document.querySelector(\"[data-sponsored-carousel]\");\r\n  if (!root) return;\r\n\r\n  sponsoredCarouselController = new SponsoredCarouselController(root);\r\n}"

if old in text:
    text = text.replace(old, new)
    print("Replaced!")
else:
    print("ERROR: still not found")
    exit(1)

with open(path, 'wb') as f:
    f.write(text.encode('utf-8'))

print("Done")
