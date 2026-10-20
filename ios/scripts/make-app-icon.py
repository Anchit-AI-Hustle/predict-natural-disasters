"""Regenerates the 1024 px app icon from the site's icons/icon-512.png.

The icon is flattened onto the site's background colour (#02110D), because
App Store icons must not be transparent. Run from the repository root:
    python3 ios/scripts/make-app-icon.py
"""
from PIL import Image

im = Image.open('icons/icon-512.png').convert('RGBA')
bg = Image.new('RGBA', im.size, (2, 17, 13, 255))
bg.alpha_composite(im)
bg.convert('RGB').resize((1024, 1024), Image.LANCZOS).save('ios/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png')
