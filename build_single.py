#!/usr/bin/env python3
"""Bundle the app into one self-contained HTML file for hosted Safari/Pages use.

Each JS module stays in its own inline <script>. That matters on older Safari:
one optional module failing to parse must not prevent the boot guard/UI from
running and explaining what happened.
"""
import pathlib, re

root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text(encoding="utf-8")
css = (root / "style.css").read_text(encoding="utf-8")
modules = {}
for name in ["state", "sysex", "audio", "ui"]:
    js = (root / "js" / f"{name}.js").read_text(encoding="utf-8")
    if "</script" in js.lower():
        raise SystemExit(f"refusing to inline {name}.js: contains </script")
    modules[name] = js

html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + css + "\n</style>")
html = html.replace('<link rel="manifest" href="manifest.webmanifest">\n', "")
onefile_cleanup = """<script>
/* One-file builds do not register a service worker. If this fresh inline
   build was reached while an old V5.1/V5.2 Monomachine cache still exists,
   unregister it once and reload outside the stale PWA cache. */
window.addEventListener('load',function(){try{if(!/^https?:/.test(location.protocol)||!window.caches||/monoRetry=/.test(location.search))return;caches.keys().then(function(keys){if(keys.some(function(k){return /^mono-web-v5\\.[12](?:-|$)/.test(k);})&&window.__monoResetCache)window.__monoResetCache();}).catch(function(){});}catch(e){}});
</script>
"""
html = re.sub(r"<script>\nif \('serviceWorker'.*?\n</script>\n", lambda _: onefile_cleanup, html, flags=re.S)
_icon = root / "icon-180.png"
if _icon.exists():
    import base64
    html = html.replace('href="icon-180.png"', 'href="data:image/png;base64,' + base64.b64encode(_icon.read_bytes()).decode() + '"')

for name, js in modules.items():
    tag = f'<script src="js/{name}.js"></script>'
    inline = (
        f'<script data-mono-module="{name}">\n'
        + js
        + f"\n;window.__monoModules=window.__monoModules||{{}};window.__monoModules.{name}=true;\n</script>"
    )
    if tag not in html:
        raise SystemExit(f"script tag not found for {name}.js")
    html = html.replace(tag, inline)

out = root.parent / "monomachine-iphone.html"
out.write_text(html, encoding="utf-8")
print(f"wrote {out} ({out.stat().st_size/1024:.0f} KB)")
