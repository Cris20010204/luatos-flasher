"""手绘线条字样 LuatOS（单线圆头，原创，不依赖任何字体）。
坐标：大写字母高 100，基线 y=100，x 高 y=32；线宽 W。返回 (路径列表, 总宽)。"""
W = 19
LETTERS = {
    # (宽度, [路径])，路径是线条中心线
    'L': (54, ['M9.5 0 V90.5 H50']),
    'u': (60, ['M9.5 32 V68 C9.5 88 19 100 31 100 C43 100 50.5 90 50.5 74', 'M50.5 32 V100']),
    'a': (62, ['M52 66 A23 24.5 0 1 1 52 65.9', 'M52 32 V100']),
    't': (42, ['M16 6 V80 C16 94 24 100 37 100', 'M2 36 H36']),
    'O': (92, ['M46 9.5 C70 9.5 82.5 27 82.5 50 C82.5 73 70 90.5 46 90.5 C22 90.5 9.5 73 9.5 50 C9.5 27 22 9.5 46 9.5 Z']),
    'S': (60, ['M53 20 C49 13 41 9.5 31 9.5 C17 9.5 9 17 9 28 C9 52 54 44 54 71 C54 84 45 90.5 31 90.5 C19 90.5 10 85 6 77']),
}
GAP = {('L','u'): 8, ('u','a'): 9, ('a','t'): 8, ('t','O'): 11, ('O','S'): 10}

def word(text='LuatOS'):
    paths, x = [], 0
    for i, ch in enumerate(text):
        w, ps = LETTERS[ch]
        paths += [f'<path transform="translate({x} 0)" d="{p}"/>' for p in ps]
        x += w + (GAP.get((ch, text[i+1]), 10) if i + 1 < len(text) else 0)
    return paths, x

def word_group(cx, cy, height, color, text='LuatOS', width_hint=None):
    """以 (cx, cy) 为中心放字样，大写高 height"""
    paths, w = word(text)
    s = height / 100
    return (f'<g transform="translate({cx - w*s/2:.2f} {cy - 50*s:.2f}) scale({s:.4f})" fill="none" stroke="{color}" '
            f'stroke-width="{W}" stroke-linecap="round" stroke-linejoin="round">' + ''.join(paths) + '</g>'), w * s

if __name__ == '__main__':
    g, w = word_group(400, 120, 140, '#1E293B')
    open('word.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="240" viewBox="0 0 800 240"><rect width="800" height="240" fill="#fff"/>{g}</svg>')
    print('width', w)
