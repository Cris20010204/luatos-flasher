"""定稿：G（USB 插头 + 闪电 + LuatOS），插头放大。输出 app-icon.svg 和 app-mark.svg。"""
import sys; sys.path.insert(0, '.')
from word import word_group
BOLT = "M566 176 L290 560 H486 L446 848 L734 444 H536 Z"

def art(plug_w=250, plug_top=196, plug_h=300, text_cy=752, text_h=90):
    cx = 512
    body_x = cx - plug_w / 2
    body_bot = plug_top + plug_h
    tip_w = plug_w * 0.64
    tip_top, tip_h = body_bot - 12, 124
    neck_w = plug_w * 0.4
    bolt_s = plug_h / 1000 * 0.98
    return f'''<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8B5CF6"/><stop offset="1" stop-color="#4C1D95"/></linearGradient>
  <linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EDE9FE"/></linearGradient>
</defs>
<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)"/>
<rect x="{cx-24}" y="100" width="48" height="{plug_top-100+10}" fill="#FFFFFF" fill-opacity="0.9"/>
<rect x="{cx-neck_w/2:.1f}" y="{plug_top-34}" width="{neck_w:.1f}" height="50" rx="14" fill="#FFFFFF" fill-opacity="0.92"/>
<rect x="{cx-tip_w/2:.1f}" y="{tip_top}" width="{tip_w:.1f}" height="{tip_h}" rx="26" fill="#D9D1FB"/>
<rect x="{cx-tip_w*0.32:.1f}" y="{tip_top+52}" width="{tip_w*0.64:.1f}" height="26" rx="13" fill="#6D28D9" fill-opacity="0.5"/>
<rect x="{body_x:.1f}" y="{plug_top}" width="{plug_w}" height="{plug_h}" rx="52" fill="url(#body)"/>
<path transform="translate({cx} {plug_top + plug_h/2}) scale({bolt_s:.3f}) translate(-512 -512)" d="{BOLT}" fill="#7C3AED" stroke-linejoin="round"/>
{word_group(cx, text_cy, text_h, '#FFFFFF')[0]}
'''

if __name__ == '__main__':
    a = art()
    note = '<!-- LuatOS 烧录器 应用图标（原创：USB 插头 + 闪电 + 手绘 LuatOS 字样）。生成脚本 design/icon-gen/gen_g.py -->'
    open('app-icon.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">\n{note}\n{a}</svg>\n')
    open('app-mark.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="824" height="824" viewBox="100 100 824 824">\n{a}</svg>\n')
