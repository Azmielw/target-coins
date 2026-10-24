# Rebuild docs/index.html (GitHub Pages copy) from index.html (Claude artifact source).
s=open('index.html').read()
head='<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b0b0c"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>\n'
lines=s.split('\n'); hb=[]; body=[]
for i,l in enumerate(lines):
    (hb if i<8 and l.startswith(('<title','<meta','<link')) else body).append(l)
open('docs/index.html','w').write(head+'\n'.join(hb)+'\n</head><body>\n'+'\n'.join(body)+'\n</body></html>\n')
