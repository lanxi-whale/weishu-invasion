"""Reference-derived Kazdel hologram; historical generator name retained.
Requires Pillow, NumPy, OpenCV. Supply the reference once; reruns use saved art.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
SAVED = ROOT / 'game/public/assets/local/ui/camps/kazdel-reference.png'
SAVED_ARTWORK = SAVED.with_name('kazdel-artwork.png')


def build(source):
    rgb = np.array(Image.open(source).convert('RGB'))
    h, w = rgb.shape[:2]
    # Source-specific silhouette: broken crown, open supports, spiked walls.
    outline = np.array([(157,0),(456,0),(462,37),(545,70),(580,102),(619,145),
        (625,210),(594,275),(554,305),(567,332),(543,355),(545,435),
        (580,467),(606,458),(630,494),(668,440),(704,478),(745,428),
        (745,760),(0,760),(0,450),(25,460),(77,527),(95,445),
        (131,517),(146,453),(175,501),(187,350),(170,341),(194,326),
        (162,312),(188,302),(165,276),(171,253),(151,229),(166,215),
        (144,191),(166,175),(141,151),(153,123),(140,96)],np.float32)
    outline *= (w/745,h/760)
    mask = np.zeros((h,w),np.uint8)
    cv2.fillPoly(mask,[outline.astype(np.int32)],255)
    cv2.line(mask,(int(w*.90),int(h*.29)),(int(w*.90),h),255,max(2,int(w*.009)))
    mast = np.array([(625,340),(673,330),(706,347),(684,359),(689,391),(660,399),(646,378),(648,354)],np.float32)
    mast *= (w/745,h/760)
    cv2.fillPoly(mask,[mast.astype(np.int32)],255)
    gray = cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
    smooth = cv2.bilateralFilter(gray,5,24,3)
    edges = cv2.Canny(smooth,38,100).astype(np.float32)/255
    count, labels, stats, _ = cv2.connectedComponentsWithStats(edges.astype(np.uint8),8)
    keep = np.zeros(count,np.float32)
    keep[1:] = stats[1:,cv2.CC_STAT_AREA]>=7
    edges *= keep[labels]
    edge_neighbors = cv2.dilate(edges,cv2.getStructuringElement(cv2.MORPH_CROSS,(3,3)))
    contours = np.maximum(edges*.64,edge_neighbors*.13)
    tone = smooth.astype(np.float32)/255
    local = cv2.createCLAHE(clipLimit=1.6,tileGridSize=(8,8)).apply(smooth).astype(np.float32)/255
    facade = np.array([(237,270),(494,276),(530,318),(513,473),(547,550),
        (467,591),(219,574),(194,484),(201,351)],np.float32)
    facade *= (w/745,h/760)
    focus = np.zeros((h,w),np.float32)
    cv2.fillPoly(focus,[facade.astype(np.int32)],1)
    focus = cv2.GaussianBlur(focus,(0,0),22)
    surface = cv2.GaussianBlur(tone,(0,0),1.2)
    surround = cv2.GaussianBlur(surface,(0,0),9)
    fine = cv2.GaussianBlur(tone,(0,0),.65)-cv2.GaussianBlur(tone,(0,0),3)
    relief = np.clip((surface-surround)*6+fine*3,-.18,.32)
    shadow_detail = focus*np.clip((.64-tone)/.30,0,1)*np.clip((local-.17)*2.1+relief,0,.66)
    # Retain continuous reference shading as well as fine contours. Pale sky
    # is suppressed smoothly; warm crown windows remain readable and solid.
    warm = np.maximum(rgb[:,:,0].astype(float)-rgb[:,:,2],0)
    glow = np.clip(warm/150,0,1)
    detail = np.clip(tone**1.6*.24+glow*.48+contours+shadow_detail,0,1)
    low, high = np.array([24,9,14]),np.array([240,168,167])
    color = low+detail[...,None]*(high-low)
    sky = np.clip((smooth.astype(np.float32)-85)/65,0,1)*(1-np.clip(warm/65,0,1))
    alpha = .92-sky*.72
    alpha = np.maximum(alpha,edges*.78)
    alpha *= cv2.GaussianBlur(mask.astype(np.float32)/255,(31,31),8)
    yy,xx = np.mgrid[0:h,0:w]
    margin = np.minimum.reduce([xx,w-1-xx,yy,h-1-yy]).astype(np.float32)
    alpha *= np.clip(margin/14,0,1)
    return Image.fromarray(np.dstack([color.clip(0,255).astype(np.uint8),(alpha*255).astype(np.uint8)]))


def build_artwork(source):
    pixels = np.array(source.convert('RGBA'))
    height, width = pixels.shape[:2]
    brightness = pixels[:, :, :3].max(axis=2).astype(np.float32)
    matte = np.clip((brightness-8)/20,0,1)
    matte *= matte*(3-2*matte)
    columns = np.arange(width)
    rows = np.arange(height)
    horizontal = np.minimum(columns,width-1-columns)/max(1,width*.018)
    vertical = np.minimum(rows,height-1-rows)/max(1,height*.018)
    pixels[:, :, 3] = np.rint(pixels[:, :, 3]*matte*np.clip(horizontal,0,1)*np.clip(vertical[:, None],0,1))
    return Image.fromarray(pixels)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sources = parser.add_mutually_exclusive_group()
    sources.add_argument('reference', nargs='?', type=Path)
    sources.add_argument('--artwork', type=Path)
    args = parser.parse_args()
    artwork = args.artwork or (SAVED_ARTWORK if not args.reference and SAVED_ARTWORK.is_file() else None)
    source = artwork or args.reference or SAVED
    if not source.is_file():
        parser.error('Pass --artwork with finished art or supply the original court reference.')
    with Image.open(source) as image:
        original = image.convert('RGBA' if artwork else 'RGB')
    result = build_artwork(original) if artwork else build(source)
    payload = io.BytesIO()
    result.save(payload,format='WEBP',lossless=True,method=6)
    data = payload.getvalue()
    digest = hashlib.sha256(data).hexdigest()[:12]
    stem = 'kazdel-artwork' if artwork else 'kazdel-reference'
    kind = 'UserSuppliedArchitecture' if artwork else 'ReferenceDerivedArchitecture'
    rel = f'/assets/local/ui/camps/{stem}-{digest}.webp'
    for camp in ('game','game_ops'):
        folder = ROOT/camp/'public/assets/local/ui/camps'
        folder.mkdir(parents=True,exist_ok=True)
        saved = folder/f'{stem}.png'
        if source.resolve() != saved.resolve():
            original.save(saved)
        (ROOT/camp/'public'/rel.lstrip('/')).write_bytes(data)
        path = ROOT/camp/'data/local-assets.json'
        doc = json.loads(path.read_text('utf-8'))
        doc['groups']['ui/camps']['kazdel-hologram'] = {
            'path':rel,'w':result.width,'h':result.height,'kind':kind}
        path.write_text(json.dumps(doc,ensure_ascii=False,separators=(',',':')),encoding='utf-8',newline='\n')
    preview = Image.new('RGBA',result.size,'#190a0e')
    preview.alpha_composite(result)
    preview.convert('RGB').save(ROOT/('kazdel-artwork-preview.png' if artwork else 'kazdel-detail-preview.png'))
    print(f'Installed Kazdel court: {result.size}; {rel}')


if __name__ == '__main__':
    main()
