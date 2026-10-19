#!/usr/bin/env python3
"""Bundle the app into one self-contained HTML file (for Files / offline use on iPhone)."""
import pathlib, re
root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text(encoding="utf-8")
css = (root / "style.css").read_text(encoding="utf-8")
js = "\n".join((root / "js" / n).read_text(encoding="utf-8") for n in ["state.js", "sysex.js", "audio.js", "ui.js"])
html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + css + "\n</style>")
html = html.replace('<link rel="manifest" href="manifest.webmanifest">\n', "")
html = re.sub(r"<script>\nif \('serviceWorker'.*?\n</script>\n", "", html, flags=re.S)
_icon = root / "icon-180.png"
if _icon.exists():
    import base64
    html = html.replace('href="icon-180.png"', 'href="data:image/png;base64,' + base64.b64encode(_icon.read_bytes()).decode() + '"')
html = re.sub(r'<script src="js/(state|sysex|audio|ui)\.js"></script>\n', "", html)
html = html.replace("</body>", "<script>\n" + js + "\n</script>\n</body>")
out = root.parent / "monomachine-iphone.html"
out.write_text(html, encoding="utf-8")
print(f"wrote {out} ({out.stat().st_size/1024:.0f} KB)")
