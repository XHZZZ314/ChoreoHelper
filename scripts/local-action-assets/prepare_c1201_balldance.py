# 仅把此前已提取的 c1201 宫廷舞指定段转为私有本地动作；不提取游戏资源，不猜动作段。
from pathlib import Path
import contextlib, hashlib, io, json, math, os, struct, subprocess, sys, tempfile, time
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
OLD = HERE
sys.path.insert(0, str(OLD))
from resource_container import unwrap
from fbx_clip import convert, write_gltf

ROOT = Path(os.environ['LOCALAPPDATA']) / 'ChoreoHelper/direct-20260912-action-assets'
TOOL = ROOT / 'XAT/XAT/Lib/XATHavokInterop/XATHavokInterop.exe'
EXPECTED_TOOL_HASH = 'f9a4ae0dd7f30058d8b0092aca3c95a21185b446a9bbf347f9123e43dd1917b2'

PHASES = {'loop': ('574', 'loop'), 'start': ('573', 'once')}

def phase_spec(phase):
    if phase not in PHASES:
        raise ValueError('Unsupported phase; select loop or start explicitly, no end resource is available')
    timeline, clip_type = PHASES[phase]
    stem = 'balldance-' + phase
    return {'phase': phase, 'type': clip_type, 'stem': stem,
            'pap': '103-' + timeline + '-c1201-dance_elezen_' + phase + '.pap',
            'resource': 'chara/human/c1201/animation/a0001/bt_common/emote/dance_elezen_' + phase + '.pap'}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def hk_float(text):
    token = text.strip()
    return struct.unpack('<f', struct.pack('<I', int(token[1:], 16)))[0] if token.startswith('x') else float(token)

def reference(xml_path):
    root = ET.parse(xml_path).getroot()
    objects = {x.get('id'): x for x in root.findall('object')}
    containers = [x for x in objects.values() if x.get('type') == 'hkaAnimationContainer']
    if len(containers) != 1:
        raise ValueError('Expected one animation container, never guess from mapper skeletons')
    refs = containers[0].findall('./array[@name="skeletons"]/ref')
    if len(refs) != 1:
        raise ValueError('Expected one referenced body skeleton')
    selected = objects[refs[0].text.strip()]
    if selected.get('type') != 'hkaSkeleton':
        raise ValueError('Animation container does not reference a skeleton')
    names = [x.text for x in selected.findall('./array[@name="bones"]/struct/string[@name="name"]')]
    parents = list(map(int, selected.find('./array[@name="parentIndices"]').text.split()))
    poses = [[hk_float(v) for v in x.text.split()] for x in selected.findall('./array[@name="referencePose"]/vec12')]
    if not names or len(set(names)) != len(names) or len(names) != len(parents) or len(names) != len(poses):
        raise ValueError('Body skeleton arrays are ambiguous or incomplete')
    return {'count': len(names), 'bones': [{'i': i, 'n': name, 'p': parents[i], 't': poses[i][:3], 'q': poses[i][4:8], 's': poses[i][8:11]} for i, name in enumerate(names)]}

def verify_reference(actual, expected):
    if actual['count'] != expected['count']:
        raise ValueError('Converted skeleton count differs from source body skeleton')
    errors = {'t': 0.0, 'q': 0.0, 's': 0.0}
    for a, b in zip(actual['bones'], expected['bones']):
        if any(a[k] != b[k] for k in ('i', 'n', 'p')):
            raise ValueError('Converted skeleton identity/topology differs from source: ' + b['n'])
        for channel in errors:
            err = max(abs(x-y) for x, y in zip(a[channel], b[channel]))
            if channel == 'q':
                err = min(err, max(abs(x+y) for x, y in zip(a[channel], b[channel])))
            errors[channel] = max(errors[channel], err)
    if max(errors.values()) > 1e-5:
        raise ValueError('Converted reference transforms differ from source: ' + str(errors))
    return errors

def prepare(phase='loop'):
    started = time.perf_counter()
    spec = phase_spec(phase)
    inputs = {'pap': ROOT / 'assets' / spec['pap'], 'skeleton': ROOT / 'assets/c1201.sklb',
              'converter': TOOL, 'msvcp110': TOOL.with_name('msvcp110.dll'), 'msvcr110': TOOL.with_name('msvcr110.dll'),
              'fbxParser': OLD / 'fbx_clip.py', 'containerParser': OLD / 'resource_container.py', 'orchestrator': Path(__file__)}
    identity = {'schema': 1, 'sourceSkeletonCode': 'c1201', 'action': 'balldance', 'phase': phase,
                'resource': spec['resource'],
                'inputs': {name: sha(path) for name, path in inputs.items()}}
    if identity['inputs']['converter'] != EXPECTED_TOOL_HASH:
        raise ValueError('Original native converter changed; do not substitute another tool')
    key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    out_root = ROOT / 'c1201-balldance'
    final = out_root / key
    if final.exists():
        manifest = json.loads((final / 'manifest.json').read_text())
        if manifest['identity'] != identity or not all(sha(final/name) == value for name, value in manifest['outputs'].items()):
            raise ValueError('Existing output changed; preserved without overwrite')
        return dict(manifest['summary'], directory=str(final), cacheHit=True, elapsedMs=round((time.perf_counter()-started)*1000, 2))
    out_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='building-', dir=out_root) as tmp:
        folder = Path(tmp)
        (folder / 'animation.hkt').write_bytes(unwrap(inputs['pap'].read_bytes(), True, 1201))
        (folder / 'skeleton.hkt').write_bytes(unwrap(inputs['skeleton'].read_bytes(), False))
        calls = []
        def run(*args):
            begin = time.perf_counter()
            result = subprocess.run([str(TOOL), *map(str, args)], capture_output=True, timeout=45)
            record = {'command': args[0], 'exitCode': result.returncode, 'elapsedMs': round((time.perf_counter()-begin)*1000, 2),
                      'stdout': result.stdout.decode(errors='replace'), 'stderr': result.stderr.decode(errors='replace')}
            calls.append(record)
            print(json.dumps(record), file=sys.stderr)
            if result.returncode:
                raise RuntimeError('Original converter execution failed; no alternate path/host attempted: ' + json.dumps(record))
            return record['stderr']
        if run('getStats', folder/'animation.hkt') != '0/1/1' or run('getStats', folder/'skeleton.hkt') != '1/0/0':
            raise ValueError('Unsupported native container counts')
        run('addSkeleton', folder/'animation.hkt', folder/'skeleton.hkt', 0, folder/'combined.hkt')
        run('toFbxAnimation', folder/'combined.hkt', 0, 0, folder/'balldance.fbx')
        run('toXMLFile', folder/'skeleton.hkt', folder/'skeleton.xml')
        run('toXMLFile', folder/'animation.hkt', folder/'animation.xml')
        with contextlib.redirect_stdout(io.StringIO()) as parser_log:
            clip = convert(folder/'balldance.fbx', folder/(spec['stem']+'.json'), 'c1201')
        skeleton = json.loads((folder/'c1201-skeleton.json').read_text())
        ref_errors = verify_reference(skeleton, reference(folder/'skeleton.xml'))
        animation_xml = ET.parse(folder/'animation.xml').getroot()
        durations = [hk_float(x.text) for x in animation_xml.findall('./object/real[@name="duration"]')]
        if len(durations) != 1 or abs(clip['duration']-durations[0]) > 1e-4:
            raise ValueError('FBX timeline duration differs from source animation duration')
        frames = []
        for bone in clip['bones'].values():
            for channel in ('q', 't', 's'):
                rows = bone[channel]
                if rows[0][0] != 0 or abs(rows[-1][0]-durations[0]) > 1e-4 or not all(math.isfinite(v) for row in rows for v in row):
                    raise ValueError('Incomplete or nonfinite converted channels')
                frames.append(len(rows))
        clip['name'] = 'balldance motion' if phase == 'loop' else 'balldance start'
        clip['type'] = spec['type']
        clip['source'] = {'kind': 'local-game-resource', 'action': 'balldance', 'phase': phase, 'skeletonCode': 'c1201',
                          'resourcePath': identity['resource'], 'conversionCacheKey': key, 'requiredChannels': ['q', 't', 's']}
        clip['offlinePrototype']['productionImportApproved'] = False
        (folder/(spec['stem']+'.json')).write_text(json.dumps(clip, separators=(',', ':')), encoding='utf-8')
        write_gltf(clip, skeleton['bones'], folder/(spec['stem']+'.gltf'))
        summary = {'ok': True, 'sourceSkeletonCode': 'c1201', 'action': 'balldance', 'phase': phase, 'sourceRefreshed': False,
                   'boneCount': skeleton['count'], 'duration': clip['duration'], 'sourceDuration': durations[0],
                   'channelFrameCounts': sorted(set(frames)), 'referenceErrors': ref_errors,
                   'targetModelValidated': False, 'gameObserved': False, 'productionImported': False,
                   'limitations': [phase + ' phase only; no automatic start/loop/end assembly', 'uses previously extracted local bytes',
                                   'no current-character model/reference binding or visual acceptance', 'no public redistribution review']}
        names = [spec['stem']+'.json', spec['stem']+'.gltf', 'c1201-skeleton.json', 'skeleton.xml', 'animation.xml', 'balldance.fbx']
        manifest = {'identity': identity, 'calls': calls, 'parserLog': parser_log.getvalue(), 'outputs': {name: sha(folder/name) for name in names}, 'summary': summary}
        (folder/'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        folder.rename(final)
    return dict(summary, directory=str(final), cacheHit=False, elapsedMs=round((time.perf_counter()-started)*1000, 2))

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Prepare one existing c1201 palace-dance phase without extraction')
    parser.add_argument('--phase', choices=tuple(PHASES), default='loop')
    print(json.dumps(prepare(parser.parse_args().phase)))
