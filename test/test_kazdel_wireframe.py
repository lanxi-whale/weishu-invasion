import runpy
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / 'demo/_ref/handoff-2026-11-18/kazdel-original.png'
GENERATOR = runpy.run_path(str(ROOT / 'build-kazdel-wireframe.py'))


class KazdelHologramTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        art = GENERATOR['build'](REFERENCE)
        cls.alpha = np.asarray(art.getchannel('A'))
        preview = Image.new('RGBA', art.size, '#190a0e')
        preview.alpha_composite(art)
        cls.red = np.asarray(preview.getchannel('R'))

    def test_shadowed_tower_retains_visible_surface_contrast(self):
        core = self.red[330:490, 270:388]
        dark, light = np.percentile(core, [10, 90])
        self.assertGreaterEqual(light - dark, 22)

    def test_original_mast_lines_remain_distinct_at_half_size(self):
        scaled = Image.fromarray(self.red).resize((372, 380), Image.Resampling.LANCZOS)
        mast = np.asarray(scaled.crop((330, 202, 342, 270)), dtype=np.int16)
        cross_line_contrast = np.abs(np.diff(mast, axis=1))
        self.assertGreaterEqual(np.percentile(cross_line_contrast, 90), 40)

    def test_open_sky_stays_transparent_and_crown_stays_bright(self):
        self.assertEqual(int(self.alpha[300:430, 5:100].max()), 0)
        crown = self.red[135:255, 390:525]
        self.assertGreater(np.percentile(crown, 90), np.percentile(self.red[330:490, 270:388], 90))

    def test_finished_art_preserves_color_and_fades_dark_background(self):
        source = Image.new('RGBA', (100, 100), (4, 3, 8, 255))
        source.putpixel((50, 50), (96, 27, 39, 255))
        source.putpixel((51, 50), (96, 27, 39, 120))
        source.putpixel((0, 50), (96, 27, 39, 255))
        art = GENERATOR['build_artwork'](source)
        self.assertEqual(art.size, source.size)
        self.assertEqual(art.getpixel((50, 50)), (96, 27, 39, 255))
        self.assertEqual(art.getpixel((51, 50)), (96, 27, 39, 120))
        self.assertEqual(art.getpixel((10, 10))[-1], 0)
        self.assertEqual(art.getpixel((0, 50))[-1], 0)


if __name__ == '__main__':
    unittest.main()
