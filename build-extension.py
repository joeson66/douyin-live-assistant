"""Build the local Chrome extension from the no-coupon userscript. No network or dependency install."""
from pathlib import Path
import re,shutil,struct,zlib,binascii
root=Path(__file__).resolve().parent
source=(root/'douyin-live-auto.user.js').read_text()
assert re.search(r'^// @version\s+2\.2$',source,re.M)
assert not re.search(r'coupon|发券|优惠券',source,re.I)
body=re.sub(r'\A// ==UserScript==.*?// ==/UserScript==\s*','',source,count=1,flags=re.S)
ext=root/'chrome-extension'
(ext/'content.js').write_text('// Generated from douyin-live-auto.user.js v2.2.\n'+body)
license=root/'LICENSE'
shutil.copy2(license,ext/'LICENSE')
def chunk(tag,data):
    return struct.pack('!I',len(data))+tag+data+struct.pack('!I',binascii.crc32(tag+data)&0xffffffff)
def color(x,y):
    if (x<.17 and y<.17 and (x-.17)**2+(y-.17)**2>.14**2) or (x>.83 and y<.17 and (x-.83)**2+(y-.17)**2>.14**2) or (x<.17 and y>.83 and (x-.17)**2+(y-.83)**2>.14**2) or (x>.83 and y>.83 and (x-.83)**2+(y-.83)**2>.14**2): return (0,0,0,0)
    if .23<x<.78 and .25<y<.75:
        if (.23<x<.30 or .70<x<.78 or .25<y<.31 or .69<y<.75):return (255,255,255,255)
    if .36<x<.63 and (.39<y<.44 or .54<y<.59):return (255,255,255,255)
    if (x-.76)**2+(y-.73)**2<.085**2:return (70,209,152,255)
    return (233,79,96,255)
for size in [16,32,48,128]:
    raw=bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            samples=[color((x+(i+.5)/4)/size,(y+(j+.5)/4)/size) for i in range(4) for j in range(4)]
            raw.extend(round(sum(c[k] for c in samples)/16) for k in range(4))
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b'')
    (ext/f'icons/icon{size}.png').write_bytes(png)
print('Chrome extension v2.2.0 built from latest no-coupon source')
