import subprocess, re, sys
subprocess.run(['npx','esbuild','src/app.js','--bundle','--minify','--format=iife','--target=es2020','--outfile=dist/app.js','--log-level=warning'],check=True)
old=open('head.html').read()
head=old.split('<style>')[0]
css=open('src/style_old.css').read()+'\n'+open('src/style_3d.css').read()
js=open('dist/app.js').read().replace('</script','<\\/script')
html=head+'<style>'+css+'</style>\n</head>\n<body>\n<div class="grain" aria-hidden="true"></div>\n<div class="wrap" id="app"></div>\n<div class="toast" id="toast" hidden></div>\n<script>'+js+'</script>\n</body>\n</html>\n'
open('dist/index.html','w').write(html)
print('built', len(html)//1024, 'KB')
