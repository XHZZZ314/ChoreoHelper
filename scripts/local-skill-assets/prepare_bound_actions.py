# 按实际绑定 PAP 与真实技能 TMB 批量准备私有预览资源；不猜种族、不覆盖输入、不调用游戏输出。
from pathlib import Path
import base64, contextlib, io, json, struct, subprocess, sys
import xml.etree.ElementTree as ET
from prepare_motion import skeleton, mappings, retarget, phase
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'local-action-assets'))
from prepare_c1201_balldance import ROOT, TOOL, EXPECTED_TOOL_HASH, sha, reference, verify_reference
from resource_container import unwrap
from fbx_clip import convert


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def select_pap(index, folder, timeline):
    names = [r['path'] for r in timeline.get('references', []) if r['kind'] == 'animation-name']
    assert len(names) == 1, 'Missing or multiple execution animation references'
    matches = [r for r in index if r['path'].endswith('/' + timeline['key'] + '.pap')]
    assert len(matches) == 1, 'No unique actually bound PAP for exact timeline key'
    item = matches[0]; path = folder / item['file']; raw = path.read_bytes()
    assert sha(path) == item['sha256'], 'Captured PAP hash changed'
    count, code, info, start, end = struct.unpack_from('<hiiii', raw, 8)
    unwrap(raw, True, code)
    assert count == 1 and info + 40 <= start
    assert raw[info:info+32].split(b'\0')[0].decode() == names[0], 'PAP animation differs from TMB reference'
    return item, path, code, names[0]


def equivalent_outputs(a, b):
    assert a.keys() == b.keys()
    difference = 0
    for bone in a['bones']:
        for channel in ('t', 'q', 's'):
            A, B = a['bones'][bone][channel], b['bones'][bone][channel]
            assert len(A) == len(B)
            for x, y in zip(A, B):
                assert x[0] == y[0]
                error = max(abs(u-v) for u,v in zip(x[1:],y[1:]))
                if channel == 'q':
                    error = min(error,max(abs(u+v) for u,v in zip(x[1:],y[1:])))
                difference = max(difference,error)
    return difference


def main(evidence, previous, original, output, decoded_cache=None, variant_context=None):
    evidence, previous, original, out = map(Path, (evidence, previous, original, output))
    assert sha(TOOL) == EXPECTED_TOOL_HASH, 'Original converter changed'
    out.mkdir(exist_ok=False); (out/'clips').mkdir(); (out/'sources').mkdir()
    if variant_context:
        from bound_variant import load_context
        c = load_context(variant_context)
        xmlpath, target, binding, index, bindings = (c[k] for k in ('xmlpath', 'target', 'binding', 'index', 'bindings'))
        pap_folder, references, binding_file, target_code = (c[k] for k in ('pap_folder', 'references', 'binding_file', 'target_code'))
        xml = ET.parse(xmlpath).getroot()
    else:
        xmlpath = original/'action16140/conversion-inspect/target-skeleton.xml'
        xml = ET.parse(xmlpath).getroot(); target = skeleton(xml, '#0004')
        assert read(evidence/'target-skeleton-read.json')['sha256'] == sha(original/'action16140/skl_c1201b0001.sklb')
        binding = read(previous/'action16140-c1201.json')['motionBinding']
        index = read(evidence/'bound-pap-index.json'); bindings = read(evidence/'batch-binding-source.json')
        assert bindings['sourceSkeletonCode'] == 'c1201' and bindings['animationVariant'] == 1
        pap_folder = evidence/'bound-paps'
        references = sorted((evidence/'job37-references').glob('*.json'))
        binding_file = evidence/'batch-binding-source.json'
        target_code = 'c1201'
    bound = {r['path'] for r in bindings['resources']}
    cache = {}; failures = {}; report = []
    for resourcefile in references:
        record = read(resourcefile); identity = record['skill']['id']; result = dict(actionId=identity, name=record['skill']['name'])
        try:
            resource = record['resources']; assert resource['type'] == 'action' and resource['actionId'] == identity
            assert not any(t['role'] == 'cast' for t in resource['timelines']), 'Casting phase requires explicit composition'
            timelines = [t for t in resource['timelines'] if t['role'] == 'execution' and t.get('state') == 'read']
            assert len(timelines) == 1, 'No unique readable execution timeline'
            timeline = timelines[0]; item, pap, code, animation = select_pap(index, pap_folder, timeline)
            assert item['path'] in bound and item['animationVariant'] == bindings['animationVariant']
            sourcecode = 'c' + str(code).zfill(4); sourcexml = ROOT/'assets'/(sourcecode+'.xml'); sk = ROOT/'assets'/(sourcecode+'.sklb')
            assert code in (101, 1101), 'Source skeleton has no verified local conversion path'
            source = reference(sourcexml)
            assert item['sha256'] not in failures, failures.get(item['sha256'])
            if item['sha256'] not in cache:
                folder = out/'sources'/item['sha256']; folder.mkdir()
                manifest = dict(papPath=item['path'], inputs={str(p):sha(p) for p in (pap, sk, sourcexml, TOOL)}, calls=[])
                reused = Path(decoded_cache)/'sources'/item['sha256'] if decoded_cache else None
                if reused and (reused/'raw-source.json').exists():
                    prior = read(reused/'manifest.json')
                    assert prior['inputs'] == manifest['inputs'], 'Decoded cache inputs differ'
                    clip = read(reused/'raw-source.json')
                    if (reused/(sourcecode+'-skeleton.json')).exists():
                        verify_reference(read(reused/(sourcecode+'-skeleton.json')),source)
                    manifest['reusedSource'] = dict(path=str(reused/'raw-source.json'),sha256=sha(reused/'raw-source.json'))
                elif not variant_context and item['sha256'] == binding['source']['papHash']:
                    cached = original/'action16140/conversion-inspect/action16140-source.json'
                    clip = read(cached); manifest['reusedSource'] = dict(path=str(cached), sha256=sha(cached))
                    verify_reference(source, skeleton(xml, '#0003'))
                else:
                    (folder/'animation.hkt').write_bytes(unwrap(pap.read_bytes(), True, code))
                    (folder/'skeleton.hkt').write_bytes(unwrap(sk.read_bytes(), False))
                    for args in [('addSkeleton',folder/'animation.hkt',folder/'skeleton.hkt',0,folder/'combined.hkt'), ('toFbxAnimation',folder/'combined.hkt',0,0,folder/'animation.fbx')]:
                        r = subprocess.run([str(TOOL), *map(str,args)], capture_output=True, timeout=45)
                        manifest['calls'].append(dict(command=args[0], exit=r.returncode, stdout=r.stdout.decode(errors='replace'), stderr=r.stderr.decode(errors='replace')))
                        write(folder/'manifest.json',manifest)
                        assert r.returncode == 0, 'Original converter failed; evidence retained'
                    with contextlib.redirect_stdout(io.StringIO()) as log:
                        clip = convert(folder/'animation.fbx', folder/'raw-source.json', sourcecode)
                    (folder/'parser.log').write_text(log.getvalue(),encoding='utf-8')
                    manifest['convertedReferenceErrors'] = verify_reference(read(folder/(sourcecode+'-skeleton.json')),source)
                candidates = []
                for obj in xml.findall('./object[@type="hkaSkeletonMapper"]'):
                    mapping = obj.find('./struct[@name="mapping"]')
                    try:
                        verify_reference(source, skeleton(xml,mapping.find('./ref[@name="skeletonA"]').text))
                        verify_reference(target, skeleton(xml,mapping.find('./ref[@name="skeletonB"]').text))
                        mapped, errors = retarget(clip,source,target,mappings(xml,obj.get('id')))
                        candidates.append((mapped, errors, obj.get('id')))
                    except (AssertionError, ValueError):
                        continue
                assert candidates, 'No reference-verified local native skeleton mapping'
                # 两个原生 mapper 可因浮点舍入不同而等价；逐骨逐帧证明等价，绝不只凭参考姿势挑选。
                manifest['equivalentMappers'] = []
                for candidate in candidates[1:]:
                    error = equivalent_outputs(candidates[0][0],candidate[0])
                    assert error < 1e-5, 'Native mapper variants produce different dynamic motion'
                    manifest['equivalentMappers'].append(dict(object=candidate[2],dynamicMaxError=error))
                mapped, errors, mapper = candidates[0]
                manifest.update(mappingObject=mapper, referenceErrors=errors, webAppearanceAccepted=False, gameExecutionAccepted=False)
                write(folder/'manifest.json',manifest); write(folder/'raw-source.json',clip)
                cache[item['sha256']] = mapped, mapper
            mapped, mapper = cache[item['sha256']]
            tmb = out/(str(identity)+'.tmb'); tmb.write_bytes(base64.b64decode(timeline['base64'], validate=True)); assert sha(tmb) == timeline['sha256']
            stage = phase(tmb,animation,mapped['duration'])
            clip = dict(mapped, motionBinding=dict(version=1,source=dict(type='action',id=identity,variant=target_code+' / animationVariant '+str(bindings['animationVariant'])+' / '+sourcecode+' shared '+animation,animationName=animation,papHash=sha(pap),skeletonHash=sha(sk),bindingEvidenceHash=sha(binding_file),papPath=item['path']),target=binding['target'],mapping=dict(kind='mapped-local',object=mapper,evidenceHash=sha(xmlpath)),phase=stage))
            dest = out/'clips'/('action'+str(identity)+'-'+target_code+'.json'); write(dest,clip)
            result.update(state='prepared-not-visually-accepted', file=str(dest), sha256=sha(dest), sourceSkeleton=sourcecode, mapper=mapper, duration=stage['duration'])
        except (AssertionError, ValueError, KeyError, OSError, subprocess.TimeoutExpired) as error:
            result.update(state='missing-or-unsupported',reason=str(error))
        report.append(result); write(out/'coverage.json',report)
        print(json.dumps(result,ensure_ascii=True),flush=True)


if __name__ == '__main__':
    if len(sys.argv) in (4, 5) and sys.argv[1] == '--variant':
        main('.', '.', '.', sys.argv[3], sys.argv[4] if len(sys.argv) == 5 else None, sys.argv[2])
    else:
        main(*sys.argv[1:])
