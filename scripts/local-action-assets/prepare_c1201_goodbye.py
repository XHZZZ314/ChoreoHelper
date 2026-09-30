# 将已存在的 c1201 告别候选片段分别转换为本地待核验资源；不猜姿态映射、不导入资料库。
from pathlib import Path
import argparse, contextlib, hashlib, io, json, math, subprocess, sys, tempfile, time
import xml.etree.ElementTree as ET

from prepare_c1201_balldance import ROOT, TOOL, EXPECTED_TOOL_HASH, sha, hk_float, reference, verify_reference
from resource_container import unwrap
from fbx_clip import convert, write_gltf

HERE = Path(__file__).resolve().parent
VARIANTS = {'s_goodbye_st': '652', 'j_goodbye_st': '663', 'u_goodbye_st': '681', 'goodbye_st': '706'}


def variant_spec(variant):
    if variant not in VARIANTS:
        raise ValueError('Select one explicit existing goodbye variant; posture/action mapping is unverified')
    return {'variant': variant, 'stem': 'goodbye-' + variant, 'type': 'once',
            'pap': '16-' + VARIANTS[variant] + '-c1201-' + variant + '.pap'}


def validate_channels(clip, source_duration):
    if not math.isfinite(source_duration) or source_duration <= 0 or not math.isfinite(clip['duration']) or abs(clip['duration'] - source_duration) > 1e-4:
        raise ValueError('FBX timeline duration differs from source animation duration')
    frames = set()
    for bone in clip['bones'].values():
        for channel, size in [('q', 5), ('t', 4), ('s', 4)]:
            rows = bone[channel]
            if not rows or any(len(row) != size or not all(math.isfinite(v) for v in row) for row in rows):
                raise ValueError('Incomplete or nonfinite converted channels')
            if rows[0][0] != 0 or abs(rows[-1][0] - source_duration) > 1e-4:
                raise ValueError('Incomplete converted channel duration')
            if any(a[0] >= b[0] for a, b in zip(rows, rows[1:])):
                raise ValueError('Non-increasing converted channel times')
            frames.add(len(rows))
    if not frames:
        raise ValueError('Missing converted bones')
    return sorted(frames)


def cached_summary(final, identity, names):